import JSON5 from 'json5';
import { ZodError } from 'zod';
import { PlanSchema } from '../../frontend/src/continuous/types';

// Convert Python literals only outside quoted strings; never evaluate model output.
function literals(text: string) {
  let result = '',
    quote = '',
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      result += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      result += c;
    } else {
      const match = /^(True|False|None)\b/.exec(text.slice(i));
      if (match && !/[\w$]/.test(text[i - 1] ?? '')) {
        result += { True: 'true', False: 'false', None: 'null' }[match[1]];
        i += match[1].length - 1;
      } else result += c;
    }
  }
  return result;
}

export function normalizeModelPlan(content: string) {
  const repairs: string[] = [];
  let text = content.replace(/^\uFEFF/, '').trim();
  const fence = /^```(?:json|json5|python)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) {
    text = fence[1];
    repairs.push('code_fence');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = JSON5.parse(literals(text));
    repairs.push('json5_literals');
  }
  if (typeof value === 'string') {
    value = JSON.parse(value);
    repairs.push('encoded_json');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.type === 'json_object') {
      delete value.type;
      repairs.push('response_format_metadata');
    }
    for (const field of ['speech', 'routine', 'combat'])
      if (value[field] === null) {
        delete value[field];
        repairs.push(`${field}_null`);
      }
    const speech = value.speech;
    if (speech && typeof speech === 'object') {
      if (speech.text_note === '' || speech.text_note === null) {
        delete speech.text_note;
        repairs.push('empty_text_note');
      }
    }
    for (const [object, fields] of [
      [value.task, ['amount']],
      [value.routine, ['reserveDays']],
      [value.combat, ['retreatHp']],
    ] as const)
      for (const field of fields)
        if (object && typeof object[field] === 'string' && /^-?\d+(\.\d+)?$/.test(object[field])) {
          object[field] = Number(object[field]);
          repairs.push(`${field}_number`);
        }
    for (const field of ['eat', 'fetch', 'work'])
      if (value.routine && ['true', 'false'].includes(value.routine[field])) {
        value.routine[field] = value.routine[field] === 'true';
        repairs.push(`${field}_boolean`);
      }
  }
  const plan = PlanSchema.parse(value);
  return { plan, content: JSON.stringify(plan), repairs };
}

export function planError(error: unknown) {
  if (error instanceof ZodError)
    return error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
  return error instanceof Error ? error.message : String(error);
}

export function parseModelPlan(content: string) {
  return normalizeModelPlan(content).plan;
}
