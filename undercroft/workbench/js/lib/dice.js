import { parseBindingPathSegments } from "./component-data.js";

const MAX_DICE_COUNT = 200;
const MAX_REROLLS = 100;
const MAX_EXPLOSIONS = 1000;

const DICE_FUNCTIONS = {
  abs: Math.abs,
  ceil: Math.ceil,
  clamp(value, min, max) {
    const v = Number(value);
    return Math.min(Math.max(v, Number(min)), Number(max));
  },
  floor: Math.floor,
  max: (...values) => Math.max(...values.map(Number)),
  min: (...values) => Math.min(...values.map(Number)),
  round: Math.round,
  sum: (...values) => values.reduce((total, current) => total + Number(current || 0), 0),
  avg: (...values) => {
    if (!values.length) {
      return 0;
    }
    const total = values.reduce((acc, current) => acc + Number(current || 0), 0);
    return total / values.length;
  },
  mod: (dividend, divisor) => Number(dividend) % Number(divisor),
  pow: (base, exponent) => Math.pow(Number(base), Number(exponent)),
  sqrt: (value) => Math.sqrt(Number(value)),
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveContextValue(context, path) {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const segments = parseBindingPathSegments(`@${path}`);
  if (!segments || !segments.length) {
    return undefined;
  }
  return segments.reduce((accumulator, segment) => {
    if (accumulator == null) {
      return undefined;
    }
    if (Array.isArray(accumulator) && /^\d+$/.test(segment)) {
      return accumulator[Number(segment)];
    }
    if (accumulator && typeof accumulator === "object" && segment in accumulator) {
      return accumulator[segment];
    }
    return undefined;
  }, context);
}

function substituteVariables(expression, context) {
  if (!expression) {
    return "";
  }
  return expression.replace(/@([A-Za-z0-9_.\[\]]+)/g, (_, path) => {
    const value = resolveContextValue(context, path);
    if (value === undefined || value === null) {
      return "0";
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "0";
    }
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return String(numeric);
    }
    return "0";
  });
}

function clampDiceCount(count) {
  if (!Number.isFinite(count)) {
    return 0;
  }
  if (count < 0) {
    return 0;
  }
  if (count > MAX_DICE_COUNT) {
    return MAX_DICE_COUNT;
  }
  return Math.floor(count);
}

function evaluateComparator(value, comparator) {
  if (!comparator) {
    return false;
  }
  const target = Number(comparator.target);
  const v = Number(value);
  switch (comparator.operator) {
    case ">":
      return v > target;
    case ">=":
      return v >= target;
    case "<":
      return v < target;
    case "<=":
      return v <= target;
    case "!=":
      return v !== target;
    case "=":
    case "==":
      return v === target;
    default:
      return false;
  }
}

function createRoll(value, { fromExplosion = false, depth = 0 } = {}) {
  return {
    rawValue: value,
    baseValue: value,
    value,
    compareValue: value,
    history: [],
    rerolled: false,
    discarded: false,
    fromExplosion,
    depth,
    penetrating: false,
    penetratedValue: null,
    exploded: false,
    compound: false,
    compoundValues: [],
    compoundEntries: [],
    success: false,
    failure: false,
    critical: null,
  };
}

class DiceParser {
  constructor(input, { random = Math.random } = {}) {
    this.input = input;
    this.length = input.length;
    this.index = 0;
    this.random = typeof random === "function" ? random : Math.random;
  }

  parse() {
    this.skipWhitespace();
    const expression = this.parseExpression();
    this.skipWhitespace();
    if (this.index < this.length) {
      throw new Error("Unexpected token in dice expression");
    }
    return expression;
  }

  peek() {
    return this.input[this.index] || "";
  }

  consume() {
    const char = this.input[this.index] || "";
    this.index += 1;
    return char;
  }

  skipWhitespace() {
    while (this.index < this.length && /\s/.test(this.input[this.index])) {
      this.index += 1;
    }
  }

  parseExpression() {
    let node = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      const char = this.peek();
      if (char === "+" || char === "-") {
        this.consume();
        const right = this.parseTerm();
        node = {
          type: "binary",
          operator: char,
          left: node,
          right,
          value: char === "+" ? node.value + right.value : node.value - right.value,
        };
        continue;
      }
      break;
    }
    return node;
  }

  parseTerm() {
    let node = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      const char = this.peek();
      if (char === "*" || char === "/") {
        this.consume();
        const right = this.parseFactor();
        if (char === "/" && right.value === 0) {
          throw new Error("Division by zero in dice expression");
        }
        node = {
          type: "binary",
          operator: char,
          left: node,
          right,
          value: char === "*" ? node.value * right.value : node.value / right.value,
        };
        continue;
      }
      break;
    }
    return node;
  }

  parseFactor() {
    this.skipWhitespace();
    const char = this.peek();
    if (char === "+" || char === "-") {
      this.consume();
      const operand = this.parseFactor();
      return {
        type: "unary",
        operator: char,
        value: char === "-" ? -operand.value : operand.value,
        operand,
      };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    this.skipWhitespace();
    const start = this.index;
    const char = this.peek();

    if (char === "(") {
      this.consume();
      const expression = this.parseExpression();
      this.skipWhitespace();
      if (this.consume() !== ")") {
        throw new Error("Missing closing parenthesis in dice expression");
      }
      return {
        type: "group",
        value: expression.value,
        expression,
      };
    }

    if (/\d/.test(char)) {
      const numberToken = this.readNumber();
      this.skipWhitespace();
      if (this.peek().toLowerCase() === "d") {
        this.consume();
        return this.parseDice(numberToken.value, numberToken.start);
      }
      return {
        type: "number",
        value: numberToken.value,
      };
    }

    if (char.toLowerCase() === "d") {
      this.consume();
      return this.parseDice(1, start);
    }

    if (/[A-Za-z_]/.test(char)) {
      const identifier = this.readIdentifier();
      this.skipWhitespace();
      if (this.peek() === "(") {
        return this.parseFunction(identifier);
      }
      throw new Error(`Unexpected token '${identifier}' in dice expression`);
    }

    throw new Error("Invalid dice expression");
  }

  readNumber() {
    const start = this.index;
    let sawDigit = false;
    while (/\d/.test(this.peek())) {
      sawDigit = true;
      this.consume();
    }
    if (this.peek() === ".") {
      this.consume();
      while (/\d/.test(this.peek())) {
        sawDigit = true;
        this.consume();
      }
    }
    if (!sawDigit) {
      throw new Error("Expected a number in dice expression");
    }
    const raw = this.input.slice(start, this.index);
    return { value: Number(raw), start };
  }

  readIdentifier() {
    const start = this.index;
    while (/[A-Za-z0-9_]/.test(this.peek())) {
      this.consume();
    }
    return this.input.slice(start, this.index);
  }

  parseFunction(name) {
    this.consume(); // "("
    const args = [];
    this.skipWhitespace();
    if (this.peek() !== ")") {
      while (true) {
        const argument = this.parseExpression();
        args.push(argument);
        this.skipWhitespace();
        const char = this.peek();
        if (char === ",") {
          this.consume();
          this.skipWhitespace();
          continue;
        }
        break;
      }
    }
    if (this.consume() !== ")") {
      throw new Error(`Function ${name} is missing a closing parenthesis`);
    }
    const fn = DICE_FUNCTIONS[name.toLowerCase()];
    if (typeof fn !== "function") {
      throw new Error(`Unsupported function '${name}' in dice expression`);
    }
    const values = args.map((arg) => arg.value);
    const value = fn(...values);
    return {
      type: "function",
      name,
      args,
      value,
    };
  }

  parseComparator() {
    this.skipWhitespace();
    let operator = this.peek();
    if (!operator) {
      throw new Error("Expected comparator in dice expression");
    }
    if (operator === ">" || operator === "<") {
      this.consume();
      if (this.peek() === "=") {
        operator += this.consume();
      }
    } else if (operator === "=") {
      this.consume();
      operator = "=";
    } else if (operator === "!") {
      this.consume();
      if (this.peek() === "=") {
        this.consume();
        operator = "!=";
      } else {
        throw new Error("Expected '=' after '!' in comparator");
      }
    } else {
      throw new Error("Invalid comparator in dice expression");
    }
    this.skipWhitespace();
    let sign = 1;
    const signChar = this.peek();
    if (signChar === "+" || signChar === "-") {
      sign = signChar === "-" ? -1 : 1;
      this.consume();
    }
    const numberToken = this.readNumber();
    return { operator, target: sign * numberToken.value };
  }

  parseDice(count, startIndex) {
    this.skipWhitespace();
    const sidesChar = this.peek();
    if (!sidesChar) {
      throw new Error("Dice expression is missing sides value");
    }
    let sides;
    if (sidesChar === "%") {
      this.consume();
      sides = 100;
    } else if (sidesChar.toLowerCase() === "f") {
      this.consume();
      sides = "F";
    } else if (/\d/.test(sidesChar)) {
      const numberToken = this.readNumber();
      sides = numberToken.value;
    } else {
      throw new Error("Dice expression has invalid sides value");
    }

    const options = {
      keep: null,
      drop: null,
      reroll: null,
      explode: null,
      success: null,
      criticalSuccess: null,
      criticalFailure: null,
    };

    while (true) {
      this.skipWhitespace();
      const char = this.peek().toLowerCase();
      if (!char) {
        break;
      }
      if (char === "k") {
        this.consume();
        options.keep = this.parseKeepDrop({ sides, defaultType: "highest" });
        continue;
      }
      if (char === "d") {
        this.consume();
        options.drop = this.parseKeepDrop({ sides, defaultType: "lowest" });
        continue;
      }
      if (char === "r") {
        this.consume();
        options.reroll = this.parseReroll();
        continue;
      }
      if (char === "!") {
        this.consume();
        options.explode = this.parseExplosion();
        continue;
      }
      if (char === "c") {
        this.consume();
        const next = this.peek().toLowerCase();
        if (next === "s" || next === "f") {
          this.consume();
          if (next === "s") {
            options.criticalSuccess = this.parseCritical({ sides, type: "success" });
          } else {
            options.criticalFailure = this.parseCritical({ sides, type: "failure" });
          }
          continue;
        }
        throw new Error("Unexpected 'c' modifier in dice expression");
      }
      if (char === ">" || char === "<" || char === "=" || char === "!") {
        options.success = this.parseComparator();
        continue;
      }
      break;
    }

    const notation = this.input.slice(startIndex, this.index).trim();
    return this.evaluateDice({ count, sides, options, notation });
  }

  parseKeepDrop({ sides, defaultType }) {
    let type = defaultType;
    const next = this.peek().toLowerCase();
    if (next === "h") {
      type = "highest";
      this.consume();
    } else if (next === "l") {
      type = "lowest";
      this.consume();
    }
    this.skipWhitespace();
    let count = 1;
    if (/\d/.test(this.peek())) {
      const numberToken = this.readNumber();
      count = Math.max(0, Math.floor(numberToken.value));
    }
    if (!Number.isFinite(count) || count < 0) {
      count = 0;
    }
    return { type, count };
  }

  parseReroll() {
    let once = false;
    if (this.peek().toLowerCase() === "o") {
      this.consume();
      once = true;
    }
    this.skipWhitespace();
    let comparator = null;
    const char = this.peek();
    if (char === ">" || char === "<" || char === "=" || char === "!") {
      comparator = this.parseComparator();
    } else if (/\d/.test(char)) {
      const numberToken = this.readNumber();
      comparator = { operator: "=", target: numberToken.value };
    }
    if (!comparator) {
      comparator = { operator: "=", target: 1 };
    }
    return { once, comparator };
  }

  parseExplosion() {
    let mode = "standard";
    let penetrating = false;
    if (this.peek() === "!") {
      this.consume();
      mode = "compound";
    }
    if (this.peek().toLowerCase() === "p") {
      this.consume();
      penetrating = true;
    }
    let comparator = null;
    const char = this.peek();
    if (char === ">" || char === "<" || char === "=" || char === "!") {
      comparator = this.parseComparator();
    }
    return { mode, penetrating, comparator };
  }

  parseCritical({ sides, type }) {
    this.skipWhitespace();
    let comparator = null;
    const char = this.peek();
    if (char === ">" || char === "<" || char === "=" || char === "!") {
      comparator = this.parseComparator();
    } else if (/\d/.test(char)) {
      const numberToken = this.readNumber();
      comparator = { operator: "=", target: numberToken.value };
    }
    if (!comparator) {
      if (type === "success") {
        comparator = { operator: "=", target: typeof sides === "number" ? sides : 1 };
      } else {
        comparator = { operator: "=", target: 1 };
      }
    }
    return comparator;
  }

  rollSingleDie(sides) {
    if (sides === "F") {
      const value = Math.floor(this.random() * 3) - 1;
      return value;
    }
    const numericSides = Math.max(1, Math.floor(Number(sides)));
    const roll = Math.floor(this.random() * numericSides) + 1;
    return roll;
  }

  evaluateDice({ count, sides, options, notation }) {
    const diceCount = clampDiceCount(count);
    if (diceCount === 0) {
      return {
        type: "dice",
        value: 0,
        detail: {
          notation,
          rolls: [],
          total: 0,
          success: null,
        },
      };
    }

    const results = [];
    for (let index = 0; index < diceCount; index += 1) {
      const initial = this.rollSingleDie(sides);
      const roll = createRoll(initial);
      this.applyReroll(roll, sides, options.reroll);
      const extras = this.applyExplosion(roll, sides, options.explode);
      results.push(roll);
      extras.forEach((extra) => {
        results.push(extra);
      });
    }

    this.applyDrop(results, options.drop);
    this.applyKeep(results, options.keep);
    const success = this.applySuccess(results, sides, options);
    const total = success
      ? success.net
      : results.filter((roll) => !roll.discarded).reduce((sum, roll) => sum + roll.value, 0);

    return {
      type: "dice",
      value: total,
      detail: {
        notation,
        rolls: results,
        total,
        success,
      },
    };
  }

  applyReroll(roll, sides, rerollOptions) {
    if (!rerollOptions || !rerollOptions.comparator) {
      return;
    }
    let iterations = 0;
    while (evaluateComparator(roll.value, rerollOptions.comparator)) {
      roll.history.push(roll.value);
      const next = this.rollSingleDie(sides);
      roll.value = next;
      roll.baseValue = next;
      roll.compareValue = next;
      roll.rawValue = next;
      roll.rerolled = true;
      iterations += 1;
      if (rerollOptions.once || iterations >= MAX_REROLLS) {
        break;
      }
      if (iterations >= MAX_REROLLS) {
        break;
      }
    }
  }

  shouldExplode(value, sides, explodeOptions) {
    if (!explodeOptions) {
      return false;
    }
    if (explodeOptions.comparator) {
      return evaluateComparator(value, explodeOptions.comparator);
    }
    if (sides === "F") {
      return value === 1;
    }
    const numericSides = Math.max(1, Math.floor(Number(sides)));
    return value === numericSides;
  }

  applyExplosion(baseRoll, sides, explodeOptions) {
    if (!explodeOptions) {
      return [];
    }
    const additional = [];
    const queue = [baseRoll];
    let iterations = 0;
    while (queue.length && iterations < MAX_EXPLOSIONS) {
      const current = queue.shift();
      if (!this.shouldExplode(current.compareValue, sides, explodeOptions)) {
        continue;
      }
      const raw = this.rollSingleDie(sides);
      const extra = createRoll(raw, { fromExplosion: true, depth: current.depth + 1 });
      extra.compareValue = raw;
      extra.exploded = true;
      if (explodeOptions.mode === "compound") {
        const addValue = explodeOptions.penetrating ? Math.max(raw - 1, 0) : raw;
        baseRoll.compound = true;
        baseRoll.exploded = true;
        baseRoll.compoundValues.push(addValue);
        baseRoll.compoundEntries.push(extra);
        baseRoll.value += addValue;
        baseRoll.compareValue = raw;
        queue.push(extra);
      } else {
        if (explodeOptions.penetrating) {
          extra.penetrating = true;
          extra.penetratedValue = Math.max(raw - 1, 0);
          extra.value = extra.penetratedValue;
        }
        additional.push(extra);
        queue.push(extra);
      }
      iterations += 1;
    }
    return additional;
  }

  applyDrop(results, dropOptions) {
    if (!dropOptions || !dropOptions.count) {
      return;
    }
    const available = results.filter((roll) => !roll.discarded);
    if (!available.length) {
      return;
    }
    const sorted = [...available].sort((a, b) => (dropOptions.type === "highest" ? b.value - a.value : a.value - b.value));
    const limit = Math.min(dropOptions.count, sorted.length);
    for (let index = 0; index < limit; index += 1) {
      sorted[index].discarded = true;
    }
  }

  applyKeep(results, keepOptions) {
    if (!keepOptions || !keepOptions.count) {
      return;
    }
    const available = results.filter((roll) => !roll.discarded);
    if (!available.length) {
      return;
    }
    const sorted = [...available].sort((a, b) => (keepOptions.type === "highest" ? b.value - a.value : a.value - b.value));
    const keepSet = new Set(sorted.slice(0, Math.min(keepOptions.count, sorted.length)));
    available.forEach((roll) => {
      if (!keepSet.has(roll)) {
        roll.discarded = true;
      }
    });
  }

  applySuccess(results, sides, options) {
    if (!options.success && !options.criticalSuccess && !options.criticalFailure) {
      return null;
    }
    let successes = 0;
    let failures = 0;
    results.forEach((roll) => {
      if (roll.discarded) {
        return;
      }
      if (options.success && evaluateComparator(roll.value, options.success)) {
        roll.success = true;
        successes += 1;
      }
      if (options.criticalSuccess && evaluateComparator(roll.value, options.criticalSuccess)) {
        roll.critical = "success";
        successes += 1;
      }
      if (options.criticalFailure && evaluateComparator(roll.value, options.criticalFailure)) {
        roll.critical = "failure";
        failures += 1;
      }
    });
    return { successes, failures, net: successes - failures };
  }
}

function collectDiceDetails(node, target = []) {
  if (!node) {
    return target;
  }
  if (node.type === "dice" && node.detail) {
    target.push(node.detail);
  }
  if (node.type === "binary") {
    collectDiceDetails(node.left, target);
    collectDiceDetails(node.right, target);
  } else if (node.type === "unary") {
    collectDiceDetails(node.operand, target);
  } else if (node.type === "group") {
    collectDiceDetails(node.expression, target);
  } else if (node.type === "function") {
    node.args.forEach((arg) => collectDiceDetails(arg, target));
  }
  return target;
}

function formatRollValue(roll) {
  let text = "";
  if (roll.history.length) {
    text = [...roll.history, roll.value].join("→");
  } else if (roll.penetrating && roll.penetratedValue !== null) {
    text = `${roll.rawValue}→${roll.penetratedValue}`;
  } else if (roll.compoundValues.length) {
    const extras = roll.compoundValues.join("+");
    text = `${roll.baseValue}+${extras}`;
  } else {
    text = String(roll.value);
  }
  const classes = ["dice-roll-value"];
  if (roll.discarded) {
    classes.push("discarded");
  }
  if (roll.success) {
    classes.push("success");
  }
  if (roll.critical === "success") {
    classes.push("critical-success");
  } else if (roll.critical === "failure") {
    classes.push("critical-failure");
  }
  if (roll.fromExplosion) {
    classes.push("exploded");
  }
  return `<span class="${classes.join(" ")}">${escapeHtml(text)}</span>`;
}

function formatDiceDetail(detail) {
  const values = detail.rolls.length ? detail.rolls.map((roll) => formatRollValue(roll)).join(" ") : "—";
  let summary;
  if (detail.success) {
    const parts = [`${detail.success.net >= 0 ? "" : "−"}${Math.abs(detail.success.net)} success${Math.abs(detail.success.net) === 1 ? "" : "es"}`];
    if (detail.success.failures) {
      parts.push(`(${detail.success.successes} success${detail.success.successes === 1 ? "" : "es"}, ${detail.success.failures} failure${detail.success.failures === 1 ? "" : "s"})`);
    }
    summary = parts.join(" ");
  } else {
    summary = `${detail.total}`;
  }
  return `
    <div class="dice-breakdown-line">
      <span class="dice-breakdown-notation">${escapeHtml(detail.notation)}</span>
      <span class="dice-breakdown-values">${values}</span>
      <span class="dice-breakdown-summary">${escapeHtml(summary)}</span>
    </div>
  `;
}

function formatNodeExpressions(node) {
  if (!node) {
    return { expression: "", computed: "", precedence: 4 };
  }
  if (node.type === "number") {
    return { expression: String(node.value), computed: String(node.value), precedence: 4 };
  }
  if (node.type === "dice") {
    return {
      expression: node.detail?.notation || "",
      computed: String(node.value),
      precedence: 4,
    };
  }
  if (node.type === "unary") {
    const operand = formatNodeExpressions(node.operand);
    const precedence = 3;
    const wrapOperand = operand.precedence < precedence ? `(${operand.expression})` : operand.expression;
    const wrapComputed = operand.precedence < precedence ? `(${operand.computed})` : operand.computed;
    return {
      expression: `${node.operator}${wrapOperand}`,
      computed: `${node.operator}${wrapComputed}`,
      precedence,
    };
  }
  if (node.type === "binary") {
    const left = formatNodeExpressions(node.left);
    const right = formatNodeExpressions(node.right);
    const precedence = node.operator === "+" || node.operator === "-" ? 1 : 2;
    const leftExpr = left.precedence < precedence ? `(${left.expression})` : left.expression;
    const rightExpr = right.precedence < precedence ? `(${right.expression})` : right.expression;
    const leftComputed = left.precedence < precedence ? `(${left.computed})` : left.computed;
    const rightComputed = right.precedence < precedence ? `(${right.computed})` : right.computed;
    return {
      expression: `${leftExpr} ${node.operator} ${rightExpr}`,
      computed: `${leftComputed} ${node.operator} ${rightComputed}`,
      precedence,
    };
  }
  if (node.type === "group") {
    const inner = formatNodeExpressions(node.expression);
    return {
      expression: `(${inner.expression})`,
      computed: `(${inner.computed})`,
      precedence: inner.precedence,
    };
  }
  if (node.type === "function") {
    const args = node.args.map((arg) => formatNodeExpressions(arg));
    const expression = `${node.name}(${args.map((arg) => arg.expression).join(", ")})`;
    const computed = `${node.name}(${args.map((arg) => arg.computed).join(", ")})`;
    return { expression, computed, precedence: 4 };
  }
  return { expression: "", computed: "", precedence: 4 };
}

function buildDetailHtml(ast) {
  const diceDetails = collectDiceDetails(ast);
  const diceHtml = diceDetails.map((detail) => formatDiceDetail(detail)).join("");
  const expressionInfo = formatNodeExpressions(ast);
  const expressionHtml = `<div class="dice-breakdown-expression">${escapeHtml(expressionInfo.computed)} = ${escapeHtml(ast.value)}</div>`;
  return `${diceHtml}${expressionHtml}`;
}

function buildDetailText(ast) {
  const diceDetails = collectDiceDetails(ast);
  const diceParts = diceDetails.map((detail) => {
    const values = detail.rolls.length ? detail.rolls.map((roll) => (roll.history.length ? `${roll.history.join("→")}→${roll.value}` : String(roll.value))).join(", ") : "none";
    if (detail.success) {
      return `${detail.notation}: ${values} => ${detail.success.net} successes`;
    }
    return `${detail.notation}: ${values} => ${detail.total}`;
  });
  const expressionInfo = formatNodeExpressions(ast);
  diceParts.push(`${expressionInfo.computed} = ${ast.value}`);
  return diceParts.join("; ");
}

export function rollDiceExpression(expression, { context = {}, random = Math.random } = {}) {
  if (typeof expression !== "string") {
    throw new Error("Enter a dice expression like 2d6 + 3.");
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("Enter a dice expression like 2d6 + 3.");
  }
  const substituted = substituteVariables(trimmed, context);
  const parser = new DiceParser(substituted, { random });
  const ast = parser.parse();
  if (!isFiniteNumber(ast.value)) {
    throw new Error("Dice expression produced an invalid result.");
  }
  return {
    total: ast.value,
    notation: trimmed,
    detailHtml: buildDetailHtml(ast),
    detailText: buildDetailText(ast),
    dice: collectDiceDetails(ast),
    expression: formatNodeExpressions(ast).expression,
  };
}
