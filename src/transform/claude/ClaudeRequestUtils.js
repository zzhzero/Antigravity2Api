/**
 * Shared helpers for ClaudeRequestIn.
 * Keep these pure / side-effect free so they’re safe to reuse.
 */

/**
 * 将 schema 类型转换为大写
 */
function uppercaseSchemaTypes(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(uppercaseSchemaTypes);

  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type") {
      if (typeof value === "string") {
        normalized[key] = value.toUpperCase();
      } else if (Array.isArray(value)) {
        normalized[key] = value.map((item) => (typeof item === "string" ? item.toUpperCase() : item));
      } else {
        normalized[key] = value;
      }
      continue;
    }
    normalized[key] = typeof value === "object" && value !== null ? uppercaseSchemaTypes(value) : value;
  }
  return normalized;
}

/**
 * 清理 JSON Schema 以符合 Gemini 格式
 */
// Helper to infer type from value
function inferType(val) {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val;
}

// Helper to assume if schema is just wrapping enums
function isSimpleEnum(s) {
  return s && typeof s === "object" && Array.isArray(s.enum) && Object.keys(s).every(k => k === "enum" || k === "type");
}

function cleanJsonSchema(schema, options = {}) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => cleanJsonSchema(s, options));

  const validationFields = {
    minLength: "minLength",
    maxLength: "maxLength",
    minimum: "minimum",
    maximum: "maximum",
    exclusiveMinimum: "exclusiveMinimum",
    exclusiveMaximum: "exclusiveMaximum",
    minItems: "minItems",
    maxItems: "maxItems",
  };
  const removeKeys = new Set([
    "$schema",
    "additionalProperties",
    "default",
    "uniqueItems",
    "propertyNames",
    "patternProperties",
    "unevaluatedProperties",
  ]);
  // Combinators to check
  const combinators = ["anyOf", "oneOf", "allOf"];

  let constValue;
  const validations = [];
  for (const [field, label] of Object.entries(validationFields)) {
    if (field in schema) {
      validations.push(`${label}: ${schema[field]}`);
    }
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    // Recursively clean combinators
    if (combinators.includes(key)) {
      if (Array.isArray(value)) {
        const cleanedList = value.map((s) => cleanJsonSchema(s, options));
        // Optimization: Flatten anyOf/oneOf if all options are enums of the same type
        if ((key === "anyOf" || key === "oneOf") && cleanedList.length > 0 && cleanedList.every(isSimpleEnum)) {
          const types = new Set(cleanedList.map(s => s.type).filter(Boolean));
          if (types.size <= 1) {
            const mergedEnum = cleanedList.flatMap(s => s.enum);
            cleaned.enum = Array.from(new Set(mergedEnum));
            if (types.size === 1) cleaned.type = types.values().next().value;
            continue;
          }
        }
        cleaned[key] = cleanedList;
      } else {
        cleaned[key] = value;
      }
      continue;
    }

    if (key === "const") {
      constValue = value;
      continue;
    }

    if (removeKeys.has(key) || key in validationFields) continue;

    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const cleanedProperties = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        cleanedProperties[propName] =
          typeof propSchema === "object" && propSchema !== null
            ? cleanJsonSchema(propSchema, options)
            : propSchema;
      }
      cleaned.properties = cleanedProperties;
      continue;
    }

    // Normalize union types like ["string","null"]
    if (key === "type" && Array.isArray(value)) {
      const filtered = value.filter((v) => v !== "null");
      cleaned.type = filtered[0] || value[0] || "string";
      if (value.includes("null")) {
        cleaned.nullable = true;
      }
      continue;
    }

    if (key === "description" && validations.length > 0) {
      cleaned[key] = `${value} (${validations.join(", ")})`;
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = cleanJsonSchema(value, options);
    } else {
      cleaned[key] = value;
    }
  }

  if (constValue !== undefined) {
    if (!cleaned.enum) cleaned.enum = [];
    cleaned.enum.push(constValue);
    // Infer type if missing
    if (!cleaned.type) {
      cleaned.type = inferType(constValue);
    }
  }

  if (cleaned.enum && cleaned.enum.length > 1) {
    cleaned.enum = Array.from(new Set(cleaned.enum));
  }

  if (validations.length > 0 && !cleaned.description) {
    cleaned.description = `Validation: ${validations.join(", ")}`;
  }

  if (options.uppercaseTypes !== false) {
    return uppercaseSchemaTypes(cleaned);
  }
  return cleaned;
}

function estimateBase64BytesLength(b64) {
  const s = String(b64 || "").trim();
  if (!s) return 0;
  let padding = 0;
  if (s.endsWith("==")) padding = 2;
  else if (s.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

function extractInlineDataPartsFromClaudeToolResultContent(rawContent) {
  if (!Array.isArray(rawContent)) {
    const text =
      typeof rawContent === "string"
        ? rawContent
        : rawContent && typeof rawContent === "object"
          ? JSON.stringify(rawContent)
          : String(rawContent || "");
    return { contentText: text, sanitizedContent: rawContent, inlineParts: [] };
  }

  const inlineParts = [];
  const sanitized = [];
  const textSegments = [];

  for (const block of rawContent) {
    if (block && typeof block === "object") {
      if (block.type === "text") {
        const t = typeof block.text === "string" ? block.text : "";
        if (t) textSegments.push(t);
        sanitized.push(block);
        continue;
      }

      if (block.type === "image") {
        const source = block.source && typeof block.source === "object" ? block.source : null;
        const data = source && typeof source.data === "string" ? source.data : null;
        const mimeType = source && (source.media_type || source.mediaType) ? (source.media_type || source.mediaType) : "image/png";
        if (data) {
          inlineParts.push({ inlineData: { mimeType, data } });
          const bytesLen = estimateBase64BytesLength(data);
          const placeholder = `[inline image omitted from JSON (${mimeType}, ~${bytesLen} bytes)]`;
          textSegments.push(placeholder);
          sanitized.push({
            ...block,
            source: {
              ...source,
              data: placeholder,
            },
          });
          continue;
        }
      }
    }

    // Fallback: preserve structure and provide a small textual hint.
    try {
      textSegments.push(typeof block === "string" ? block : JSON.stringify(block));
    } catch (_) {
      textSegments.push(String(block));
    }
    sanitized.push(block);
  }

  return {
    contentText: textSegments.join("\n"),
    sanitizedContent: inlineParts.length > 0 ? sanitized : rawContent,
    inlineParts,
  };
}

module.exports = {
  cleanJsonSchema,
  extractInlineDataPartsFromClaudeToolResultContent,
};
