/**
 * A small Zod -> OpenAPI/JSON Schema converter.
 *
 * The app already describes every request in Zod (see `validate({ params, query,
 * body })`), so the spec can be derived from those schemas instead of restated by
 * hand in `@openapi` comments. That is the whole point: a comment goes stale the
 * moment a field changes, a schema cannot.
 *
 * Written by hand rather than pulled in as a dependency because it only needs the
 * subset of Zod this codebase actually uses, and because a runtime dependency on a
 * doc generator is a heavier trade than 150 lines of mapping.
 *
 * Anything it does not recognise degrades to a permissive `{ type: string }` rather
 * than throwing, so a new Zod feature can never take the docs down.
 */

type Json = Record<string, any>;

const FIRST = (_: string, obj: any): string => obj?._def?.typeName;

/** Zod string check kind -> OpenAPI format. */
const STRING_FORMATS: Record<string, string> = {
  email: 'email',
  uuid: 'uuid',
  cuid: 'string',
  cuid2: 'string',
  url: 'uri',
  emoji: 'string',
  datetime: 'date-time',
  date: 'date',
  time: 'string',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  base64: 'byte',
};

/**
 * Copies Zod's constraints onto the JSON Schema.
 *
 * `def.checks` is an array of plain records like `{ kind: 'min', value: 2 }` - not
 * ZodCheck instances - so each kind is read directly. Getting this wrong fails
 * silently: the documented field degrades to a bare `{ type: 'string' }` with no
 * bounds, no pattern and no format, and nothing anywhere reports a problem.
 *
 * Returns whether the value is a whole number, so callers can pick integer vs number.
 */
const describeChecks = (checks: any, json: Json): boolean => {
  if (!Array.isArray(checks)) return false;

  let isInteger = false;

  for (const check of checks) {
    const kind = check?.kind;
    const value = check?.value;

    if (kind === 'int' || kind === 'integer') {
      isInteger = true;
    } else if (kind === 'multipleOf') {
      json.multipleOf = value;
    } else if ((kind === 'min' || kind === 'max') && typeof value === 'number') {
      // Exclusive bounds need the JSON Schema `exclusive*` keywords, otherwise
      // `positive()` would be documented as "minimum: 0" and admit zero.
      if (check.inclusive === false) {
        if (kind === 'min') json.exclusiveMinimum = value;
        else json.exclusiveMaximum = value;
      } else if (json.type === 'string') {
        if (kind === 'min') json.minLength = value;
        else json.maxLength = value;
      } else if (kind === 'min') {
        json.minimum = value;
      } else {
        json.maximum = value;
      }
    } else if (kind === 'regex' && check.regex instanceof RegExp) {
      json.pattern = check.regex.source;
    } else if (typeof kind === 'string' && STRING_FORMATS[kind] && json.type === 'string') {
      json.format = STRING_FORMATS[kind];
    }
  }

  return isInteger;
};

const convert = (input: any): Json => {
  if (!input || typeof input !== 'object' || !input._def) return { type: 'string' };

  const def = input._def;
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodString': {
      const json: Json = { type: 'string' };
      describeChecks(def.checks, json);
      return json;
    }

    case 'ZodNumber': {
      const json: Json = { type: 'number' };
      if (describeChecks(def.checks, json)) json.type = 'integer';
      return json;
    }

    case 'ZodBigInt':
      return { type: 'integer' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodDate':
      return { type: 'string', format: 'date-time' };

    case 'ZodLiteral':
      return { type: typeof def.value === 'number' ? 'number' : 'string', enum: [def.value] };

    case 'ZodEnum':
      return { type: 'string', enum: [...(def.values ?? [])] };

    case 'ZodNativeEnum': {
      // Prisma enums come through as a value -> name map.
      const values = Object.values(def.values ?? {}).filter((v) => typeof v !== 'number');
      return { type: 'string', enum: values };
    }

    case 'ZodArray':
      return { type: 'array', items: convert(def.type) };

    case 'ZodTuple':
      return { type: 'array', items: {} };

    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {});
      const required: string[] = [];
      const properties: Json = {};

      for (const [key, value] of Object.entries<any>(shape)) {
        const optional = FIRST('x', value) === 'ZodOptional';
        properties[key] = convert(value);
        if (!optional) required.push(key);
      }

      const json: Json = { type: 'object', properties };
      if (required.length) json.required = required;
      // `.strict()` means an unknown key is a 400, which is worth documenting.
      if (def.unknownKeys === 'strict') json.additionalProperties = false;
      return json;
    }

    case 'ZodRecord':
      return { type: 'object', additionalProperties: convert(def.valueType) };

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options ?? []).map(convert);
      const first = options[0] ?? { type: 'string' };
      if (options.length > 1) return { oneOf: options };
      return first;
    }

    case 'ZodIntersection':
      return { allOf: def.left && def.right ? [convert(def.left), convert(def.right)] : [] };

    case 'ZodOptional':
    case 'ZodNullable': {
      const inner = convert(def.innerType);
      // OpenAPI 3.0 has no `type: null`, so a nullable field becomes nullable via an
      // explicit empty enum alongside the real type.
      if (typeName === 'ZodNullable') return { ...inner, nullable: true };
      return inner;
    }

    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodBranded':
      return convert(def.innerType);

    case 'ZodEffects':
      // refine/transform carry no JSON Schema, but the inner type still documents the shape.
      return convert(def.schema);

    case 'ZodAny':
    case 'ZodUnknown':
      /*
       * Deliberately typeless. `z.any()` is what a hand-written `superRefine` validator
       * wraps, so the real shape is invisible from here and lives in the hand-written
       * block. An empty schema marks that as "nothing to say", letting the merge keep
       * the documented body instead of overwriting it with an invented string type.
       */
      return {};

    case 'ZodNull':
      return { type: 'string', nullable: true };

    case 'ZodPipeline':
      return convert(def.out);

    default:
      return { type: 'string' };
  }
};

/**
 * A plausible example for a field, chosen from its name.
 *
 * A documented body that says every string is "string" tells a caller nothing about
 * what to send. Matching on the field name gets `email` -> a real address,
 * `pincode` -> six digits, `password` -> something that satisfies the password rules,
 * which is the difference between usable docs and a schema dump.
 */
const exampleFor = (name: string, schema: any): any => {
  const n = name.toLowerCase();

  if (Array.isArray(schema?.enum) && schema.enum.length) return schema.enum[0];

  const type = schema?.type;
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') {
    if (/percent|rate/.test(n)) return 10;
    if (/qty|count|stock|limit|page/.test(n)) return 2;
    if (/price|amount|total|subtotal/.test(n)) return 999;
    return 1;
  }
  if (type === 'array') return [exampleFor(name.replace(/s$/, ''), schema.items)];
  if (type !== 'string') return undefined;

  if (schema.format === 'date-time') return '2026-01-15T10:30:00.000Z';
  if (schema.format === 'date') return '2026-01-15';
  if (/otp|code$/.test(n) && schema.pattern === undefined) {
    if (/pincode/.test(n)) return '400050';
    if (/otp/.test(n)) return '111111';
  }
  if (/email/.test(n)) return 'user@example.com';
  if (/phone|mobile/.test(n)) return '+919876543210';
  if (/password/.test(n)) return 'Secret@123';
  if (/name$|holdername|fullname/.test(n)) return 'Ramesh Sharma';
  if (/slug/.test(n)) return 'classic-cotton-shirt';
  if (/url|link|webhook/.test(n)) return 'https://example.com/hook';
  if (/image|logo|photo|avatar/.test(n))
    return 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
  if (/currency/.test(n)) return 'INR';
  if (/locale|language/.test(n)) return 'en';
  if (/ifsc/.test(n)) return 'HDFC0001234';
  if (/accountno/.test(n)) return '4111111111111111';
  if (/upi/.test(n)) return 'user@upi';
  if (/sku/.test(n)) return 'SKU-001';
  if (/status|state|role|type$/.test(n)) return schema.enum?.[0] ?? 'ACTIVE';
  if (/token|secret|apikey/.test(n)) return 'abcdef123456';
  if (/description|message|reason|comment|note/.test(n)) return 'Set by the caller.';
  if (/pincode/.test(n)) return '400050';
  if (/city/.test(n)) return 'Mumbai';
  if (/address|city|state|country/.test(n)) return 'Mumbai';

  // Anything named `*id` that looks like a cuid.
  if (/id$/i.test(n) && (schema.maxLength ?? 0) <= 40) return 'clx0000000000000000000000';
  if (/number$/.test(n) && (schema.maxLength ?? 0) <= 40) return 'ORD12345678ABCDEF';

  if (schema.pattern) return undefined;
  return 'string';
};

/** Converts a Zod object schema into an OpenAPI request-body schema, with examples. */
export const zodToRequestSchema = (schema: any): Json => {
  const json = convert(schema);

  // Walk the tree so nested objects and array items get examples too, not just the
  // top level fields.
  const decorate = (node: any): void => {
    if (!node || typeof node !== 'object') return;

    if (node.properties) {
      for (const [key, prop] of Object.entries<any>(node.properties)) {
        if (prop && typeof prop === 'object') {
          if (!prop.example) {
            const example = exampleFor(key, prop);
            if (example !== undefined) prop.example = example;
          }
          decorate(prop);
        }
      }
    }
    if (node.items) decorate(node.items);
  };

  decorate(json);

  return json;
};

/** Converts a Zod object schema into a flat list of OpenAPI parameters. */
export const zodToParameters = (schema: any, location: 'path' | 'query' | 'header'): Json[] => {
  const json = convert(schema);
  const properties = json.properties ?? {};
  const required: string[] = json.required ?? [];

  return Object.entries<any>(properties).map(([name, prop]) => {
    const isRequired = required.includes(name);
    const out: Json = {
      name,
      in: location,
      required: location === 'path' ? true : isRequired,
      schema: { ...prop },
    };
    if (prop.description) out.description = prop.description;
    if (!prop.example) {
      const example = exampleFor(name, prop);
      if (example !== undefined) out.example = example;
    }
    return out;
  });
};
