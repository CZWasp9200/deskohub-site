// scripts/workspace-e2e-allocation.ts
import { appendFile } from "node:fs/promises";
// ../../node_modules/effect/dist/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype;
  return PipeableBase;
}();

// ../../node_modules/effect/dist/Function.js
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constFalse = /* @__PURE__ */ constant(false);
var constUndefined = /* @__PURE__ */ constant(undefined);
var constVoid = constUndefined;
function flow(ab, bc, cd, de, ef, fg, gh, hi, ij) {
  switch (arguments.length) {
    case 1:
      return ab;
    case 2:
      return function() {
        return bc(ab.apply(this, arguments));
      };
    case 3:
      return function() {
        return cd(bc(ab.apply(this, arguments)));
      };
    case 4:
      return function() {
        return de(cd(bc(ab.apply(this, arguments))));
      };
    case 5:
      return function() {
        return ef(de(cd(bc(ab.apply(this, arguments)))));
      };
    case 6:
      return function() {
        return fg(ef(de(cd(bc(ab.apply(this, arguments))))));
      };
    case 7:
      return function() {
        return gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))));
      };
    case 8:
      return function() {
        return hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments))))))));
      };
    case 9:
      return function() {
        return ij(hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))))));
      };
  }
  return;
}
function memoize(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}
function memoizeIdempotent(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    if (result !== a) {
      cache.set(result, result);
    }
    return result;
  };
}

// ../../node_modules/effect/dist/internal/equal.js
var errorSiteKeys = ["line", "column", "sourceURL", "originalLine", "originalColumn"];
var getAllObjectKeys = (obj) => {
  const keys = new Set(Reflect.ownKeys(obj));
  if (obj.constructor === Object)
    return keys;
  if (obj instanceof Error) {
    keys.delete("stack");
    for (const key of errorSiteKeys) {
      if (!Object.prototype.propertyIsEnumerable.call(obj, key))
        keys.delete(key);
    }
  }
  const proto = Object.getPrototypeOf(obj);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0;i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet;
var viewBytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
var isArrayBufferLike = (u) => u instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && u instanceof SharedArrayBuffer;
var bufferBytes = (buffer) => {
  try {
    return new Uint8Array(buffer);
  } catch {
    return;
  }
};

// ../../node_modules/effect/dist/internal/hash.js
var backEdges = 0;
var addBackEdge = () => {
  backEdges++;
};

// ../../node_modules/effect/dist/Predicate.js
function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isFunction(input) {
  return typeof input === "function";
}
function isNotNullish(input) {
  return input != null;
}
function isUnknown(_) {
  return true;
}
function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && (property in self));
function isError(input) {
  return input instanceof Error;
}
function isIterable(input) {
  return hasProperty(input, Symbol.iterator) || isString(input);
}

// ../../node_modules/effect/dist/Hash.js
var symbol = "~effect/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "string":
      return string(self);
    case "function":
    case "object": {
      if (self === null) {
        break;
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        const cached = hashCache.get(self);
        if (cached !== undefined) {
          return cached;
        }
        if (visitedObjects.has(self)) {
          addBackEdge();
          return string("[Circular]");
        }
        visitedObjects.add(self);
        const seen = backEdges;
        let h;
        try {
          if (isHash(self)) {
            h = self[symbol]();
          } else if (typeof self === "function") {
            h = random(self);
          } else if (isArrayBufferLike(self)) {
            const bytes = bufferBytes(self);
            h = bytes === undefined ? random(self) : array(bytes);
          } else if (self instanceof DataView) {
            h = array(viewBytes(self));
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            h = array(self);
          } else if (self instanceof Map) {
            h = hashMap(self);
          } else if (self instanceof Set) {
            h = hashSet(self);
          } else {
            h = structure(self);
          }
        } finally {
          visitedObjects.delete(self);
        }
        if (seen === backEdges) {
          hashCache.set(self, h);
        }
        return h;
      }
    }
  }
  return optimize(mix(string(String(self))));
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, optimize(Math.random() * 4294967296 | 0));
  }
  return randomHashCache.get(self);
};
var mix = (h) => {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return h ^ h >>> 16;
};
var combine = /* @__PURE__ */ dual(2, (self, b) => mix(Math.imul(self, 2654435761) + Math.imul(b, 2246822507)));
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol) && typeof u[symbol] === "function";
var float64 = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
var number = (n) => {
  const h = n | 0;
  if (h === n) {
    return optimize(h);
  }
  float64.setFloat64(0, n !== n ? NaN : n);
  return optimize(combine(float64.getInt32(0), float64.getInt32(4)));
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var unordered = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = (arr) => {
  let h = 6151;
  for (const element of arr) {
    h = combine(h, hash(element));
  }
  return optimize(h);
};
var hashMap = /* @__PURE__ */ unordered(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var setSeed = /* @__PURE__ */ string("Set");
var hashSet = /* @__PURE__ */ unordered(setSeed, (element) => combine(setSeed, hash(element)));
var randomHashCache = /* @__PURE__ */ new WeakMap;
var hashCache = /* @__PURE__ */ new WeakMap;
var visitedObjects = /* @__PURE__ */ new WeakSet;

// ../../node_modules/effect/dist/Equal.js
var symbol2 = "~effect/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that)
    return true;
  if (self == null || that == null)
    return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return compareObjects(self, that);
}
function compareObjects(self, that) {
  const depth = pathLeft.length;
  for (let i = depth;i-- > 0; ) {
    if (pathLeft[i] === self && pathRight[i] === that)
      return true;
  }
  if (depth)
    return compareOnPath(self, that);
  let known = results.get(self);
  if (!known)
    results.set(self, known = new WeakMap);
  let result = known.get(that);
  if (result === undefined)
    known.set(that, result = compareOnPath(self, that));
  return result;
}
function compareOnPath(self, that) {
  pathLeft.push(self);
  pathRight.push(that);
  try {
    return compareStructure(self, that);
  } finally {
    pathLeft.pop();
    pathRight.pop();
  }
}
var pathLeft = [];
var pathRight = [];
var results = /* @__PURE__ */ new WeakMap;
function compareStructure(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date))
      return false;
    const selfTime = self.getTime();
    const thatTime = that.getTime();
    return selfTime === thatTime || Number.isNaN(selfTime) && Number.isNaN(thatTime);
  } else if (self instanceof RegExp) {
    return that instanceof RegExp && self.toString() === that.toString();
  }
  const bothEquals = isEqual(self);
  if (bothEquals !== isEqual(that) || typeof self === "function" && !bothEquals) {
    return false;
  } else if (bothEquals) {
    return self[symbol2](that);
  } else if (Array.isArray(self)) {
    if (!Array.isArray(that) || self.length !== that.length) {
      return false;
    }
    return compareArrays(self, that);
  } else if (isArrayBufferLike(self)) {
    if (!isArrayBufferLike(that) || self instanceof ArrayBuffer !== that instanceof ArrayBuffer) {
      return false;
    }
    const selfBytes = bufferBytes(self);
    const thatBytes = bufferBytes(that);
    return selfBytes !== undefined && thatBytes !== undefined && compareTypedArrays(selfBytes, thatBytes);
  } else if (ArrayBuffer.isView(self)) {
    const selfIsDataView = self instanceof DataView;
    if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength || selfIsDataView !== that instanceof DataView) {
      return false;
    }
    if (selfIsDataView) {
      return compareTypedArrays(viewBytes(self), viewBytes(that));
    }
    return compareTypedArrays(self, that);
  } else if (self instanceof Map) {
    if (!(that instanceof Map) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, entryHash, equalEntries);
  } else if (self instanceof Set) {
    if (!(that instanceof Set) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, hash, compareBoth);
  }
  return compareRecords(self, that);
}
function compareArrays(self, that) {
  for (let i = 0;i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function compareHashed(self, that, hashOf, equivalent) {
  const groups = new Map;
  let remaining = 0;
  for (const item of that) {
    const h = hashOf(item);
    const group = groups.get(h);
    if (group)
      group.push(item);
    else
      groups.set(h, [item]);
    remaining++;
  }
  outer:
    for (const item of self) {
      const group = groups.get(hashOf(item));
      if (group) {
        for (let i = 0;i < group.length; i++) {
          if (equivalent(item, group[i])) {
            group[i] = group[group.length - 1];
            group.pop();
            remaining--;
            continue outer;
          }
        }
      }
      return false;
    }
  return remaining === 0;
}
var entryHash = (entry) => hash(entry[0]);
var equalEntries = (self, that) => compareBoth(self[0], that[0]) && compareBoth(self[1], that[1]);
var isEqual = (u) => hasProperty(u, symbol2) && typeof u[symbol2] === "function";
var asEquivalence = () => equals;

// ../../node_modules/effect/dist/Redactable.js
var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u))
    return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyMap = /* @__PURE__ */ new Map;
var emptyContext = {
  "~effect/Context": {},
  base: emptyMap,
  depth: 0,
  mapUnsafe: emptyMap,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// ../../node_modules/effect/dist/Formatter.js
function format(input, options) {
  const space = options?.space ?? 0;
  const ancestors = new WeakSet;
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    try {
      return recurUnsafe(v, d);
    } catch {
      if (typeof v === "object" && v !== null || typeof v === "function")
        ancestors.delete(v);
      return "[inspection threw]";
    }
  }
  function recurUnsafe(v, d = 0) {
    if (typeof v === "string")
      return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol")
      return String(v);
    if (typeof v === "bigint")
      return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (ancestors.has(v))
        return CIRCULAR;
      ancestors.add(v);
      let output;
      if (symbolRedactable in v) {
        output = recur(getRedacted(v), d);
      } else if (Array.isArray(v)) {
        output = !gap || v.length <= 1 ? `[${v.map((x) => recur(x, d)).join(",")}]` : `[
${ind(d + 1)}${v.map((x) => recur(x, d + 1)).join(`,
` + ind(d + 1))}
${ind(d)}]`;
      } else if (v instanceof Date) {
        output = formatDate(v);
      } else if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
        const s = safeToString(v);
        output = v instanceof Error && v.cause !== undefined ? `${s} (cause: ${recur(v.cause, d)})` : s;
      } else if (Symbol.iterator in v) {
        output = `${v.constructor.name}(${recur(Array.from(v), d)})`;
      } else {
        const keys = ownKeys(v);
        if (!gap || keys.length <= 1) {
          const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(safeGet(v, k), d)}`).join(",")}}`;
          output = wrap(v, body);
        } else {
          const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(safeGet(v, k), d + 1)}`).join(`,
`)}
${ind(d)}}`;
          output = wrap(v, body);
        }
      }
      ancestors.delete(v);
      return output;
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path) {
  return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function safeGet(input, key) {
  try {
    return input[key];
  } catch {
    return "[property access threw]";
  }
}
function formatJson(input, options) {
  const ancestors = [];
  const sources = new WeakMap;
  return JSON.stringify(input, function(key, value) {
    const original = Object.getOwnPropertyDescriptor(sources.get(this) ?? this, key)?.value;
    const redacted = hasProperty(original, symbolRedactable) ? redact(original) : redact(value);
    if (typeof redacted === "bigint") {
      return format(redacted);
    }
    if (typeof redacted !== "object" || redacted === null) {
      return redacted;
    }
    const current = redacted instanceof Error && !hasProperty(redacted, "toJSON") ? {
      ...redacted,
      name: redacted.name,
      message: redacted.message
    } : redacted;
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(redacted)) {
      return;
    }
    ancestors.push(redacted);
    if (current !== redacted) {
      ancestors.push(current);
    }
    if (!hasGetter(current) || isJsonPrimitiveWrapper(current)) {
      return current;
    }
    const view = redactingView(current);
    sources.set(view, current);
    ancestors.push(view);
    return view;
  }, options?.space) ?? "null";
}
function hasGetter(object) {
  for (const key of Object.getOwnPropertyNames(object)) {
    if (Object.getOwnPropertyDescriptor(object, key)?.get !== undefined) {
      return true;
    }
  }
  return false;
}
function redactingView(object) {
  const view = Array.isArray(object) ? [] : {};
  const keys = Array.isArray(object) ? Array.from({
    length: object.length
  }, (_, i) => String(i)) : Object.keys(object);
  for (const key of keys) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get: () => {
        const value = Reflect.get(object, key);
        return Object.getOwnPropertyDescriptor(object, key)?.get !== undefined ? redact(value) : value;
      }
    });
  }
  return view;
}
function isJsonPrimitiveWrapper(object) {
  for (const valueOf of [Number.prototype.valueOf, Boolean.prototype.valueOf, String.prototype.valueOf]) {
    try {
      Reflect.apply(valueOf, object, []);
      return true;
    } catch {}
  }
  return false;
}

// ../../node_modules/effect/dist/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    input = redact(input);
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
    return input;
  } catch {
    return "[toJSON threw]";
  }
};
var toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? formatJson(u, {
      space: whitespace
    }) : format(u, {
      space: whitespace
    });
  } catch {
    return String(u);
  }
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};

class Class2 {
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  toString() {
    return format(this.toJSON());
  }
}

// ../../node_modules/effect/dist/internal/stackTraceLimit.js
var isStackTraceLimitWritable = () => {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return Object.isExtensible(Error);
  }
  return Object.hasOwn(desc, "writable") ? desc.writable === true : desc.set !== undefined;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    Error.stackTraceLimit = value;
  }
};

// ../../node_modules/effect/dist/Utils.js
class SingleShotGen {
  constructor(self) {
    this.value = self;
    this.done = false;
  }
  next(a) {
    if (this.done) {
      this.value = a;
      return this;
    }
    this.done = true;
    return {
      value: this.value,
      done: false
    };
  }
}
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  const limit = getStackTraceLimit();
  if (limit === 0)
    return forced[InternalTypeId];
  setStackTraceLimit(2);
  const error = standard[InternalTypeId](() => new Error);
  setStackTraceLimit(limit);
  return error.stack?.includes(InternalTypeId) === true ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

// ../../node_modules/effect/dist/internal/record.js
function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    self[key] = value;
  }
}
function assignProperties(self, source) {
  if (!Object.hasOwn(source, "__proto__")) {
    Object.assign(self, source);
    return;
  }
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}

// ../../node_modules/effect/dist/internal/core.js
var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    if (selfKeys.length !== Object.keys(that).length)
      return false;
    for (const key of selfKeys) {
      if (!Object.prototype.propertyIsEnumerable.call(that, key) || !equals(this[key], that[key])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : undefined
    };
  }
};
var isEffect = (u) => hasProperty(u, EffectTypeId);
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
class CauseImpl {
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      reasons: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
}
var annotationsMap = /* @__PURE__ */ new WeakMap;

class ReasonBase {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0)
      return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key))
        return;
      newAnnotations.set(key, value);
    });
    if (options?.overwrite !== true && newAnnotations.size === this.annotations.size)
      return this;
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
}
var constEmptyAnnotations = /* @__PURE__ */ new Map;

class Fail extends ReasonBase {
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
}
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var dedupeReasons = (self, that) => {
  const buckets = new Map;
  const out = [];
  for (const reason of self.concat(that)) {
    const hash2 = hash(reason);
    const bucket = buckets.get(hash2);
    if (bucket === undefined) {
      buckets.set(hash2, [reason]);
    } else if (bucket.some((previous) => equals(previous, reason))) {
      continue;
    } else {
      bucket.push(reason);
    }
    out.push(reason);
  }
  return out;
};
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(dedupeReasons(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeAddInterrupts = (self, interrupts) => {
  const reasons = self.reasons.slice();
  for (const reason of interrupts.reasons) {
    if (isInterruptReason(reason) && !reasons.some((r) => isInterruptReason(r) && r.fiberId === reason.fiberId && r.annotations === reason.annotations)) {
      reasons.push(reason);
    }
  }
  return reasons.length === self.reasons.length ? self : new CauseImpl(reasons);
};
var causeEmpty = /* @__PURE__ */ new CauseImpl([]);
var causeFail = (error) => new CauseImpl([new Fail(error)]);

class Die extends ReasonBase {
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
}
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args) => isCause(args[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0)
    return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  const PrimitiveImpl = function(value) {
    this[args] = value;
  };
  PrimitiveImpl.prototype = Proto;
  return function(value) {
    return new PrimitiveImpl(value);
  };
};
var makeExit = (options) => {
  const Proto = {
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    ...makePrimitiveProto(options),
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  const ExitPrimitive = function(value) {
    this[args] = value;
  };
  ExitPrimitive.prototype = Proto;
  return function(value) {
    return new ExitPrimitive(value);
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber) {
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber) {
    let cause = this[args];
    let annotated = false;
    if (fiber.cache.stackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: new Map([[StackTraceKey.key, fiber.cache.stackFrame]])
      });
      annotated = true;
    }
    let cont = fiber.getCont(contE);
    const interruptedCause = fiber._interruptedCause;
    if (interruptedCause && fiber.interruptible) {
      let skippedHandler = false;
      while (cont && fiber.interruptible) {
        skippedHandler ||= identifier in cont;
        cont = fiber.getCont(contE);
      }
      if (skippedHandler) {
        cause = causeFromReasons(cause.reasons.filter((reason) => reason._tag !== "Fail"));
      }
      cause = causeAddInterrupts(cause, interruptedCause);
      annotated = true;
    }
    return cont ? cont[contE](cause, fiber, annotated ? undefined : this) : fiber.yieldWith(annotated ? exitFailCause(cause) : this);
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber) {
    return this[args](fiber);
  }
});
var withFiberSucceed = /* @__PURE__ */ makePrimitive({
  op: "WithFiberSucceed",
  [evaluate](fiber) {
    const value = this[args](fiber);
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var YieldableError = /* @__PURE__ */ function() {

  class YieldableError extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError.prototype, proto);
  return YieldableError;
}();
var Error2 = /* @__PURE__ */ function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args) {
      super(args?.message, args?.cause ? {
        cause: args.cause
      } : undefined);
      if (args) {
        assignProperties(this, args);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
}();
var TaggedError = (tag) => {

  class Base extends Error2 {
    _tag = tag;
  }
  Base.prototype.name = tag;
  return Base;
};
var DoneTypeId = "~effect/Cause/Done";
var isDone = (u) => hasProperty(u, DoneTypeId);
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: undefined
};
var Done = (value) => {
  if (value === undefined)
    return DoneVoid;
  return {
    [DoneTypeId]: DoneTypeId,
    _tag: "Done",
    value
  };
};
var doneVoid = /* @__PURE__ */ exitFail(DoneVoid);
var done = (value) => {
  if (value === undefined)
    return doneVoid;
  return exitFail(Done(value));
};

// ../../node_modules/effect/dist/Effectable.js
var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

// ../../node_modules/effect/dist/Equivalence.js
var make = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that);
var isStrictEquivalent = (x, y) => x === y;
var strictEqual = () => isStrictEquivalent;
function Tuple(elements) {
  return make((self, that) => {
    if (self.length !== that.length) {
      return false;
    }
    for (let i = 0;i < self.length; i++) {
      if (!elements[i](self[i], that[i])) {
        return false;
      }
    }
    return true;
  });
}
function Array_(item) {
  return make((self, that) => {
    if (self.length !== that.length)
      return false;
    for (let i = 0;i < self.length; i++) {
      if (!item(self[i], that[i]))
        return false;
    }
    return true;
  });
}

// ../../node_modules/effect/dist/internal/doNotation.js
var bind = (map, flatMap) => dual(3, (self, name, f) => flatMap(self, (a) => map(f(a), (b) => ({
  ...a,
  [name]: b
}))));

// ../../node_modules/effect/dist/internal/option.js
var TypeId = "~effect/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: undefined,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var SomeImpl = function(value) {
  this.value = value;
};
SomeImpl.prototype = SomeProto;
var some = (value) => new SomeImpl(value);

// ../../node_modules/effect/dist/internal/result.js
var TypeId2 = "~effect/Result";
var CommonProto2 = {
  [TypeId2]: {
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result) => result._tag === "Failure";
var isSuccess = (result) => result._tag === "Success";
var FailureImpl = function(failure) {
  this.failure = failure;
};
FailureImpl.prototype = FailureProto;
var fail = (failure) => new FailureImpl(failure);
var SuccessImpl = function(success) {
  this.success = success;
};
SuccessImpl.prototype = SuccessProto;
var succeed = (success) => new SuccessImpl(success);

// ../../node_modules/effect/dist/Order.js
function make2(compare) {
  return (self, that) => self === that ? 0 : compare(self, that);
}
var Number2 = /* @__PURE__ */ make2((self, that) => {
  if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that))
    return 0;
  if (globalThis.Number.isNaN(self))
    return -1;
  if (globalThis.Number.isNaN(that))
    return 1;
  return self < that ? -1 : 1;
});
var mapInput = /* @__PURE__ */ dual(2, (self, f) => make2((b1, b2) => self(f(b1), f(b2))));
var isGreaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var isLessThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== 1);

// ../../node_modules/effect/dist/Option.js
var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var match = /* @__PURE__ */ dual(2, (self, {
  onNone,
  onSome
}) => isNone2(self) ? onNone() : onSome(self.value));
var getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
var fromNullishOr = (a) => a == null ? none2() : some2(a);
var getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
var liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch {
    return none2();
  }
};

// ../../node_modules/effect/dist/Context.js
var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  function KeyClass() {}
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  const init = (key, options) => {
    self.key = key;
    if (options?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = options.defaultValue;
    }
    if (options?.make) {
      self.make = options.make;
    }
    if (options?.fiberCached) {
      cacheKeys.add(key);
    }
    return self;
  };
  return arguments.length > 0 ? init(arguments[0], arguments[1]) : init;
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber) {
      return exitSucceed(get(fiber.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make3(this, self);
  },
  use(f) {
    return withFiber((fiber) => f(get(fiber.context, this)));
  },
  useSync(f) {
    return withFiber((fiber) => exitSucceed(f(get(fiber.context, this))));
  }
};
var cacheKeys = /* @__PURE__ */ new Set;
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId3 = "~effect/Context";
var FlattenAfterBaseHits = 8;
var makeImpl = (cacheRoot, base, overlay, depth, maxDepth) => {
  const self = Object.create(Proto);
  self.cacheRoot = cacheRoot ?? self;
  self.base = base;
  self.overlay = overlay;
  self.depth = depth;
  self._flat = undefined;
  self.baseHits = 0;
  self.maxDepth = maxDepth;
  return self;
};
var applyOverlays = (map, overlay) => {
  if (!overlay)
    return;
  applyOverlays(map, overlay.parent);
  map.set(overlay.key, overlay.value);
};
var flatten = (self) => {
  if (self._flat)
    return self._flat;
  if (!self.overlay)
    return self._flat = self.base;
  const map = new Map(self.base);
  applyOverlays(map, self.overlay);
  return self._flat = map;
};
var withFlat = (self, f) => {
  const map = new Map(self.mapUnsafe);
  f(map);
  return makeImpl(undefined, map, undefined, 0, self.maxDepth);
};
var notFound = /* @__PURE__ */ Symbol();
var lookup = (self, key) => {
  const impl = self;
  for (let overlay = impl.overlay;overlay; overlay = overlay.parent) {
    if (overlay.key === key)
      return overlay.value;
  }
  const value = impl.base.get(key);
  if (value === undefined && !impl.base.has(key))
    return notFound;
  if (impl.overlay && ++impl.baseHits >= impl.base.size && impl.baseHits >= FlattenAfterBaseHits) {
    impl.base = flatten(impl);
    impl.overlay = undefined;
    impl.depth = 0;
  }
  return value;
};
var makeUnsafe = (mapUnsafe, options) => {
  const maxDepth = options?.maxDepth;
  return makeImpl(undefined, mapUnsafe, undefined, 0, Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : 8);
};
var Proto = {
  get mapUnsafe() {
    return flatten(this);
  },
  ...PipeInspectableProto,
  [TypeId3]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that))
      return false;
    const self = this.mapUnsafe;
    const other = that.mapUnsafe;
    if (self.size !== other.size)
      return false;
    for (const [key, value] of self) {
      if (!other.has(key) || !equals(value, other.get(key)))
        return false;
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var hasSameCache = (self, that) => self.cacheRoot === that.cacheRoot;
var isContext = (u) => hasProperty(u, TypeId3);
var isReference = (u) => !!u[ReferenceTypeId];
var empty = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map);
var make3 = (key, service) => makeUnsafe(new Map([[key.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, key, service) => addUnsafe(self, key.key, service));
var addUnsafe = (self, key, service) => {
  const impl = self;
  const cacheRoot = cacheKeys.has(key) ? undefined : impl.cacheRoot;
  if (impl.depth >= impl.maxDepth) {
    const map = new Map(impl._flat ?? impl.base);
    if (!impl._flat)
      applyOverlays(map, impl.overlay);
    map.set(key, service);
    return makeImpl(cacheRoot, map, undefined, 0, impl.maxDepth);
  }
  return makeImpl(cacheRoot, impl.base, {
    key,
    value: service,
    parent: impl.overlay
  }, impl.depth + 1, impl.maxDepth);
};
var getOrUndefined2 = /* @__PURE__ */ dual(2, (self, key) => getOrUndefinedUnsafe(self, key.key));
var getOrUndefinedUnsafe = (self, key) => {
  const value = lookup(self, key);
  return value === notFound ? undefined : value;
};
var getUnsafe = /* @__PURE__ */ dual(2, (self, service) => {
  const value = lookup(self, service.key);
  if (value === notFound) {
    if (isReference(service))
      return getDefaultValue(service);
    throw serviceNotFoundError(service);
  }
  return value;
});
var get = getUnsafe;
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
  const error = new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
};
var getOption = /* @__PURE__ */ dual(2, (self, service) => {
  const value = lookup(self, service.key);
  if (value !== notFound)
    return some2(value);
  return isReference(service) ? some2(getDefaultValue(service)) : none2();
});
var merge = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.mapUnsafe.size === 0)
    return that;
  if (that.mapUnsafe.size === 0)
    return self;
  return withFlat(self, (map) => that.mapUnsafe.forEach((value, key) => map.set(key, value)));
});
var mergeAll = (...ctxs) => {
  const map = new Map;
  for (let i = 0;i < ctxs.length; i++) {
    ctxs[i].mapUnsafe.forEach((value, key) => {
      map.set(key, value);
    });
  }
  return makeUnsafe(map);
};
var omit = (...keys) => (self) => withFlat(self, (map) => {
  for (let i = 0;i < keys.length; i++) {
    map.delete(keys[i].key);
  }
});
var Reference = Service;

// ../../node_modules/effect/dist/internal/array.js
var isArrayNonEmpty = (self) => self.length > 0;

// ../../node_modules/effect/dist/internal/count.js
var normalize = (n) => n > 0 ? Math.floor(n) : 0;

// ../../node_modules/effect/dist/Result.js
var succeed2 = succeed;
var fail2 = fail;
var void_ = /* @__PURE__ */ succeed2(undefined);
var try_ = (evaluate) => {
  if (isFunction(evaluate)) {
    try {
      return succeed2(evaluate());
    } catch (e) {
      return fail2(e);
    }
  } else {
    try {
      return succeed2(evaluate.try());
    } catch (e) {
      return fail2(evaluate.catch(e));
    }
  }
};
var isFailure2 = isFailure;
var isSuccess2 = isSuccess;
var map = /* @__PURE__ */ dual(2, (self, f) => isSuccess2(self) ? succeed2(f(self.success)) : self);
var match2 = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));
var getOrThrowWith = /* @__PURE__ */ dual(2, (self, onFailure) => {
  if (isSuccess2(self)) {
    return self.success;
  }
  throw onFailure(self.failure);
});
var getOrThrow = /* @__PURE__ */ getOrThrowWith(identity);
var flatMap = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(self.failure) : f(self.success));

// ../../node_modules/effect/dist/Tuple.js
var makeEquivalence = Tuple;

// ../../node_modules/effect/dist/Record.js
var has = /* @__PURE__ */ dual(2, (self, key) => Object.hasOwn(self, key));
var map2 = /* @__PURE__ */ dual(2, (self, f) => {
  const out = {
    ...self
  };
  for (const key of keys(self)) {
    assignProperty(out, key, f(self[key], key));
  }
  return out;
});
var keys = (self) => Object.keys(self);
var isSubrecordBy = (equivalence) => dual(2, (self, that) => {
  for (const key of keys(self)) {
    if (!has(that, key) || !equivalence(self[key], that[key])) {
      return false;
    }
  }
  return true;
});
var makeEquivalence2 = (equivalence) => {
  const is = isSubrecordBy(equivalence);
  return (self, that) => is(self, that) && is(that, self);
};

// ../../node_modules/effect/dist/Array.js
var Array2 = globalThis.Array;
var fromIterable = (collection) => Array2.isArray(collection) ? collection : Array2.from(collection);
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
var empty2 = () => [];
var of = (a) => [a];
var map3 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
var makeEquivalence3 = Array_;

// ../../node_modules/effect/dist/Duration.js
var TypeId4 = "~effect/Duration";
var bigint0 = /* @__PURE__ */ BigInt(0);
var bigint1 = /* @__PURE__ */ BigInt(1);
var bigint2 = /* @__PURE__ */ BigInt(2);
var bigint10 = /* @__PURE__ */ BigInt(10);
var bigint1e3 = /* @__PURE__ */ BigInt(1000);
var bigint1e6 = /* @__PURE__ */ BigInt(1e6);
var bigint1e9 = /* @__PURE__ */ BigInt(1e9);
var bigintNanosPerMinute = /* @__PURE__ */ BigInt(60000000000);
var bigintNanosPerHour = /* @__PURE__ */ BigInt(3600000000000);
var bigintNanosPerDay = /* @__PURE__ */ BigInt(86400000000000);
var bigintNanosPerWeek = /* @__PURE__ */ BigInt(604800000000000);
var roundTiesAwayFromZero = (input) => BigInt(Math.sign(input) * Math.round(Math.abs(input)));
var roundMillisToNanos = (millis) => Number.isInteger(millis) ? BigInt(millis) * bigint1e6 : roundTiesAwayFromZero(millis * 1e6);
var fromNanosNumber = (nanos) => make4(Number.isFinite(nanos) ? roundTiesAwayFromZero(nanos) : nanos);
var nanosToUnit = (nanos, divisor) => {
  const value = Number(nanos);
  if (Number.isFinite(value))
    return value / divisor;
  const scale = BigInt(divisor);
  return Number(nanos / scale) + Number(nanos % scale) / divisor;
};
var parseNanos = (input, scale) => {
  const decimalIndex = input.indexOf(".");
  if (decimalIndex === -1)
    return BigInt(input) * scale;
  const isNegative = input[0] === "-";
  const fractional = input.slice(decimalIndex + 1);
  const fractionalScale = bigint10 ** BigInt(fractional.length);
  const scaled = (BigInt(input.slice(isNegative ? 1 : 0, decimalIndex)) * fractionalScale + BigInt(fractional)) * scale;
  return divideTiesAwayFromZero(isNegative ? -scaled : scaled, fractionalScale);
};
var divideTiesAwayFromZero = (numerator, denominator) => {
  const absolute = numerator < bigint0 ? -numerator : numerator;
  const rounded = absolute / denominator + (absolute % denominator * bigint2 >= denominator ? bigint1 : bigint0);
  return numerator < bigint0 ? -rounded : rounded;
};
var fromMillisString = (input, scale) => {
  const millis = Number(input) * scale;
  if (!Number.isFinite(millis))
    return make4(millis);
  const nanos = parseNanos(input, BigInt(scale) * bigint1e6);
  return make4(Number.isInteger(millis) && BigInt(millis) * bigint1e6 === nanos ? millis : nanos);
};
var DURATION_REGEXP = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
var fromInputUnsafe = (input) => {
  switch (typeof input) {
    case "number":
      return millis(input);
    case "bigint":
      return nanos(input);
    case "string": {
      if (input === "Infinity") {
        return infinity;
      }
      if (input === "-Infinity") {
        return negativeInfinity;
      }
      const match = DURATION_REGEXP.exec(input);
      if (!match)
        break;
      const [_, valueStr, unit] = match;
      if (unit === "nano" || unit === "nanos") {
        return nanos(parseNanos(valueStr, bigint1));
      }
      if (unit === "micro" || unit === "micros") {
        return nanos(parseNanos(valueStr, bigint1e3));
      }
      switch (unit) {
        case "milli":
        case "millis":
          return fromMillisString(valueStr, 1);
        case "second":
        case "seconds":
          return fromMillisString(valueStr, 1000);
        case "minute":
        case "minutes":
          return fromMillisString(valueStr, 60000);
        case "hour":
        case "hours":
          return fromMillisString(valueStr, 3600000);
        case "day":
        case "days":
          return fromMillisString(valueStr, 86400000);
        case "week":
        case "weeks":
          return fromMillisString(valueStr, 604800000);
      }
      break;
    }
    case "object": {
      if (input === null)
        break;
      if (TypeId4 in input)
        return input;
      if (Array.isArray(input)) {
        if (input.length !== 2 || !input.every(isNumber)) {
          return invalid(input);
        }
        if (Number.isNaN(input[0]) || Number.isNaN(input[1])) {
          return zero;
        }
        if (input[0] === -Infinity || input[1] === -Infinity) {
          return negativeInfinity;
        }
        if (input[0] === Infinity || input[1] === Infinity) {
          return infinity;
        }
        const nanos = input[0] * 1e9 + input[1];
        return Number.isFinite(nanos) && Number.isInteger(input[0]) && Number.isInteger(input[1]) ? make4(BigInt(input[0]) * bigint1e9 + BigInt(input[1])) : fromNanosNumber(nanos);
      }
      const obj = input;
      let millis = 0;
      if (obj.weeks)
        millis += obj.weeks * 604800000;
      if (obj.days)
        millis += obj.days * 86400000;
      if (obj.hours)
        millis += obj.hours * 3600000;
      if (obj.minutes)
        millis += obj.minutes * 60000;
      if (obj.seconds)
        millis += obj.seconds * 1000;
      if (obj.milliseconds)
        millis += obj.milliseconds;
      if (!obj.microseconds && !obj.nanoseconds) {
        if (!Number.isFinite(millis))
          return make4(millis);
        const exact = sumObjectNanos(obj);
        return exact === undefined || BigInt(millis) * bigint1e6 === exact ? make4(millis) : make4(exact);
      }
      const nanos = millis * 1e6 + (obj.microseconds ?? 0) * 1000 + (obj.nanoseconds ?? 0);
      const exact = Number.isFinite(nanos) ? sumObjectNanos(obj) : undefined;
      return exact === undefined ? fromNanosNumber(nanos) : make4(exact);
    }
  }
  return invalid(input);
};
var isIntegerOrUnset = (n) => !n || Number.isInteger(n);
var sumObjectNanos = (obj) => {
  if (!isIntegerOrUnset(obj.weeks) || !isIntegerOrUnset(obj.days) || !isIntegerOrUnset(obj.hours) || !isIntegerOrUnset(obj.minutes) || !isIntegerOrUnset(obj.seconds) || !isIntegerOrUnset(obj.milliseconds) || !isIntegerOrUnset(obj.microseconds) || !isIntegerOrUnset(obj.nanoseconds))
    return;
  let nanos = bigint0;
  if (obj.weeks)
    nanos += BigInt(obj.weeks) * bigintNanosPerWeek;
  if (obj.days)
    nanos += BigInt(obj.days) * bigintNanosPerDay;
  if (obj.hours)
    nanos += BigInt(obj.hours) * bigintNanosPerHour;
  if (obj.minutes)
    nanos += BigInt(obj.minutes) * bigintNanosPerMinute;
  if (obj.seconds)
    nanos += BigInt(obj.seconds) * bigint1e9;
  if (obj.milliseconds)
    nanos += BigInt(obj.milliseconds) * bigint1e6;
  if (obj.microseconds)
    nanos += BigInt(obj.microseconds) * bigint1e3;
  if (obj.nanoseconds)
    nanos += BigInt(obj.nanoseconds);
  return nanos;
};
var invalid = (input) => {
  throw new Error(`Invalid Input: ${input}`);
};
var fromInput = /* @__PURE__ */ liftThrowable(fromInputUnsafe);
var zeroDurationValue = {
  _tag: "Millis",
  millis: 0
};
var infinityDurationValue = {
  _tag: "Infinity"
};
var negativeInfinityDurationValue = {
  _tag: "NegativeInfinity"
};
var DurationProto = {
  [TypeId4]: TypeId4,
  [symbol]() {
    switch (this.value._tag) {
      case "Millis":
        return hash(roundMillisToNanos(this.value.millis));
      case "Nanos":
        return hash(this.value.nanos);
      default:
        return structure(this.value);
    }
  },
  [symbol2](that) {
    return isDuration(that) && equals2(this, that);
  },
  toString() {
    switch (this.value._tag) {
      case "Infinity":
        return "Infinity";
      case "NegativeInfinity":
        return "-Infinity";
      case "Nanos":
        return `${this.value.nanos} nanos`;
      case "Millis":
        return `${this.value.millis} millis`;
    }
  },
  toJSON() {
    switch (this.value._tag) {
      case "Millis":
        return {
          _id: "Duration",
          _tag: "Millis",
          millis: this.value.millis
        };
      case "Nanos":
        return {
          _id: "Duration",
          _tag: "Nanos",
          nanos: String(this.value.nanos)
        };
      case "Infinity":
        return {
          _id: "Duration",
          _tag: "Infinity"
        };
      case "NegativeInfinity":
        return {
          _id: "Duration",
          _tag: "NegativeInfinity"
        };
    }
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make4 = (input) => {
  const duration = Object.create(DurationProto);
  if (typeof input === "number") {
    if (isNaN(input) || input === 0 || Object.is(input, -0)) {
      duration.value = zeroDurationValue;
    } else if (!Number.isFinite(input)) {
      duration.value = input > 0 ? infinityDurationValue : negativeInfinityDurationValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: roundMillisToNanos(input)
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input === bigint0) {
    duration.value = zeroDurationValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
};
var isDuration = (u) => hasProperty(u, TypeId4);
var zero = /* @__PURE__ */ make4(0);
var infinity = /* @__PURE__ */ make4(Infinity);
var negativeInfinity = /* @__PURE__ */ make4(-Infinity);
var nanos = (nanos) => make4(nanos);
var millis = (millis) => make4(millis);
var seconds = (seconds) => make4(seconds * 1000);
var toMillis = (self) => match3(fromInputUnsafe(self), {
  onMillis: identity,
  onNanos: (nanos) => nanosToUnit(nanos, 1e6),
  onInfinity: () => Infinity,
  onNegativeInfinity: () => -Infinity
});
var toSeconds = (self) => match3(fromInputUnsafe(self), {
  onMillis: (millis) => millis / 1000,
  onNanos: (nanos) => nanosToUnit(nanos, 1e9),
  onInfinity: () => Infinity,
  onNegativeInfinity: () => -Infinity
});
var toNanosUnsafe = (input) => {
  const self = fromInputUnsafe(input);
  switch (self.value._tag) {
    case "Infinity":
    case "NegativeInfinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return self.value.nanos;
    case "Millis":
      return roundMillisToNanos(self.value.millis);
  }
};
var match3 = /* @__PURE__ */ dual(2, (self, options) => {
  switch (self.value._tag) {
    case "Millis":
      return options.onMillis(self.value.millis);
    case "Nanos":
      return options.onNanos(self.value.nanos);
    case "Infinity":
      return options.onInfinity();
    case "NegativeInfinity":
      return (options.onNegativeInfinity ?? options.onInfinity)();
  }
});
var matchPair = /* @__PURE__ */ dual(3, (self, that, options) => {
  if (self.value._tag === "Infinity" || self.value._tag === "NegativeInfinity" || that.value._tag === "Infinity" || that.value._tag === "NegativeInfinity")
    return options.onInfinity(self, that);
  if (self.value._tag === "Millis") {
    return that.value._tag === "Millis" ? options.onMillis(self.value.millis, that.value.millis) : options.onNanos(toNanosUnsafe(self), that.value.nanos);
  } else {
    return options.onNanos(self.value.nanos, toNanosUnsafe(that));
  }
});
var Equivalence = (self, that) => matchPair(self, that, {
  onMillis: (self, that) => self === that,
  onNanos: (self, that) => self === that,
  onInfinity: (self, that) => self.value._tag === that.value._tag
});
var equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(self, that));

// ../../node_modules/effect/dist/Scheduler.js
var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  fiberCached: true,
  defaultValue: () => new MixedScheduler
});
var setMicrotask = (f) => {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled)
      f();
  });
  return () => {
    cancelled = true;
  };
};
var setTimer = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};
var setImmediate = (f) => {
  try {
    return setTimer(f);
  } catch {
    return setMicrotask(f);
  }
};

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (;index < len; index++) {
      if (buckets[index][0] > priority)
        break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
}

class MixedScheduler {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn ?? (executionMode === "sync" ? setMicrotask : setImmediate);
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield;
  }
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
}

class MixedSchedulerDispatcher {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  running = undefined;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === undefined) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = undefined;
    this.runTasks();
  };
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0;i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0;j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== undefined) {
        this.running();
        this.running = undefined;
      }
      this.runTasks();
    }
  }
}
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  fiberCached: true,
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  fiberCached: true,
  defaultValue: () => false
});

// ../../node_modules/effect/dist/Data.js
var TaggedError2 = TaggedError;

// ../../node_modules/effect/dist/encoding/EncodingError.js
var EncodingErrorTypeId = "~effect/encoding/EncodingError";

class EncodingError extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  [EncodingErrorTypeId] = EncodingErrorTypeId;
}

// ../../node_modules/effect/dist/encoding/Hex.js
var random2 = (length) => {
  switch (length) {
    case 16:
      return random16();
    case 32:
      return random32();
    default: {
      let result = "";
      for (let i = length >>> 3;i > 0; i--) {
        result += random8();
      }
      return result;
    }
  }
};
var hexCharCodes = /* @__PURE__ */ Uint8Array.from("0123456789abcdef", (c) => c.charCodeAt(0));
var randomWord = () => Math.random() * 4294967296 >>> 0;
var random8 = () => {
  const a = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15]);
};
var random16 = () => {
  const a = randomWord();
  const b = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15], hexCharCodes[b >>> 28], hexCharCodes[b >>> 24 & 15], hexCharCodes[b >>> 20 & 15], hexCharCodes[b >>> 16 & 15], hexCharCodes[b >>> 12 & 15], hexCharCodes[b >>> 8 & 15], hexCharCodes[b >>> 4 & 15], hexCharCodes[b & 15]);
};
var random32 = () => {
  const a = randomWord();
  const b = randomWord();
  const c = randomWord();
  const d = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15], hexCharCodes[b >>> 28], hexCharCodes[b >>> 24 & 15], hexCharCodes[b >>> 20 & 15], hexCharCodes[b >>> 16 & 15], hexCharCodes[b >>> 12 & 15], hexCharCodes[b >>> 8 & 15], hexCharCodes[b >>> 4 & 15], hexCharCodes[b & 15], hexCharCodes[c >>> 28], hexCharCodes[c >>> 24 & 15], hexCharCodes[c >>> 20 & 15], hexCharCodes[c >>> 16 & 15], hexCharCodes[c >>> 12 & 15], hexCharCodes[c >>> 8 & 15], hexCharCodes[c >>> 4 & 15], hexCharCodes[c & 15], hexCharCodes[d >>> 28], hexCharCodes[d >>> 24 & 15], hexCharCodes[d >>> 20 & 15], hexCharCodes[d >>> 16 & 15], hexCharCodes[d >>> 12 & 15], hexCharCodes[d >>> 8 & 15], hexCharCodes[d >>> 4 & 15], hexCharCodes[d & 15]);
};
var hexCodes = /* @__PURE__ */ new Uint8Array(256).fill(255);
for (let i = 0;i < 16; i++) {
  hexCodes[/* @__PURE__ */ "0123456789abcdef".charCodeAt(i)] = i;
  hexCodes[/* @__PURE__ */ "0123456789ABCDEF".charCodeAt(i)] = i;
}

// ../../node_modules/effect/dist/Tracer.js
var ParentSpanKey = "effect/Tracer/ParentSpan";

class ParentSpan extends (/* @__PURE__ */ Service()(ParentSpanKey, {
  fiberCached: true
})) {
}
var make5 = (options) => options;
var DisablePropagation = /* @__PURE__ */ Reference("effect/Tracer/DisablePropagation", {
  defaultValue: constFalse
});
var CurrentTraceLevel = /* @__PURE__ */ Reference("effect/Tracer/CurrentTraceLevel", {
  defaultValue: () => "Info"
});
var MinimumTraceLevel = /* @__PURE__ */ Reference("effect/Tracer/MinimumTraceLevel", {
  defaultValue: () => "All"
});
var TracerKey = "effect/Tracer";
var Tracer = /* @__PURE__ */ Reference(TracerKey, {
  fiberCached: true,
  defaultValue: () => nativeTracer
});
var nativeTracer = /* @__PURE__ */ make5({
  span: (options) => new NativeSpan(options)
});

class NativeSpan {
  _tag = "Span";
  sampled;
  name;
  parent;
  annotations;
  links;
  startTime;
  kind;
  status;
  _traceId = undefined;
  _spanId = undefined;
  _attributes = undefined;
  _events = undefined;
  constructor(options) {
    this.name = options.name;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links;
    this.startTime = options.startTime;
    this.kind = options.kind;
    this.sampled = options.sampled;
    this.status = {
      _tag: "Started",
      startTime: options.startTime
    };
  }
  get traceId() {
    return this._traceId ??= getOrUndefined(this.parent)?.traceId ?? random2(32);
  }
  get spanId() {
    return this._spanId ??= random2(16);
  }
  get attributes() {
    return this._attributes ??= new Map;
  }
  get events() {
    return this._events ??= [];
  }
  end(endTime, exit) {
    if (this.status._tag === "Ended")
      return;
    this.status = {
      _tag: "Ended",
      endTime,
      exit,
      startTime: this.status.startTime
    };
  }
  attribute(key, value) {
    if (this.status._tag === "Ended")
      return;
    this.attributes.set(key, value);
  }
  event(name, startTime, attributes) {
    if (this.status._tag === "Ended")
      return;
    this.events.push([name, startTime, attributes ?? {}]);
  }
  addLinks(links) {
    if (this.status._tag === "Ended")
      return;
    this.links.push(...links);
  }
}

// ../../node_modules/effect/dist/internal/metric.js
var FiberRuntimeMetricsKey = "effect/Metric/FiberRuntimeMetrics";

// ../../node_modules/effect/dist/internal/references.js
var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  fiberCached: true,
  defaultValue: constUndefined
});
var TracerEnabled = /* @__PURE__ */ Reference("effect/References/TracerEnabled", {
  fiberCached: true,
  defaultValue: constTrue
});
var TracerTimingEnabled = /* @__PURE__ */ Reference("effect/References/TracerTimingEnabled", {
  defaultValue: constTrue
});
var TracerSpanAnnotations = /* @__PURE__ */ Reference("effect/References/TracerSpanAnnotations", {
  defaultValue: () => ({})
});
var TracerSpanLinks = /* @__PURE__ */ Reference("effect/References/TracerSpanLinks", {
  defaultValue: () => []
});
var CurrentLogAnnotations = /* @__PURE__ */ Reference("effect/References/CurrentLogAnnotations", {
  defaultValue: () => ({})
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var UnhandledLogLevel = /* @__PURE__ */ Reference("effect/References/UnhandledLogLevel", {
  defaultValue: () => "Error"
});
var CurrentLogSpans = /* @__PURE__ */ Reference("effect/References/CurrentLogSpans", {
  defaultValue: () => []
});

// ../../node_modules/effect/dist/internal/tracer.js
var addSpanStackTrace = (options) => {
  if (options?.captureStackTrace === false) {
    return options;
  } else if (options?.captureStackTrace !== undefined && typeof options.captureStackTrace !== "boolean") {
    return options;
  }
  const limit = getStackTraceLimit();
  if (limit === 0 && options?.captureStackTrace !== true) {
    return {
      ...options,
      captureStackTrace: false
    };
  }
  setStackTraceLimit(3);
  const traceError = new Error;
  setStackTraceLimit(limit);
  return {
    ...options,
    captureStackTrace: spanCleaner(() => traceError.stack)
  };
};
var makeStackCleaner = (line) => (stack) => {
  let cache;
  return () => {
    if (cache !== undefined)
      return cache;
    const trace = stack();
    if (!trace)
      return;
    const lines = trace.split(`
`);
    if (lines[line] !== undefined) {
      cache = lines[line].trim();
      return cache;
    }
  };
};
var spanCleaner = /* @__PURE__ */ makeStackCleaner(3);

// ../../node_modules/effect/dist/internal/effect.js
class Interrupt extends ReasonBase {
  constructor(fiberId, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return string(`${this._tag}:${this.fiberId}`);
  }
}
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
var hasFails = (self) => self.reasons.some(isFailReason);
var findError = (self) => {
  for (let i = 0;i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason._tag === "Fail") {
      return succeed2(reason.error);
    }
  }
  return fail2(self);
};
var hasDies = (self) => self.reasons.some(isDieReason);
var causeElectDefects = (self) => hasDies(self) && hasFails(self) ? causeFromReasons(self.reasons.map((reason) => reason._tag === "Fail" && !isDone(reason.error) ? new Die(reason.error, reason.annotations) : reason)) : self;
var findRecoverableError = (self) => hasDies(self) ? fail2(causeElectDefects(self)) : findError(self);
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var causeFilterInterruptors = (self) => {
  let interruptors;
  for (let i = 0;i < self.reasons.length; i++) {
    const f = self.reasons[i];
    if (f._tag !== "Interrupt")
      continue;
    interruptors ??= new Set;
    if (f.fiberId !== undefined) {
      interruptors.add(f.fiberId);
    }
  }
  return interruptors ? succeed2(interruptors) : fail2(self);
};
var hasInterruptsOnly = (self) => self.reasons.length > 0 && self.reasons.every(isInterruptReason);
var reasonAnnotations = (self) => makeUnsafe(self.annotations);
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error), failure.annotations);
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var causeSquash = (self) => {
  let die;
  for (const reason of self.reasons) {
    if (reason._tag === "Fail")
      return reason.error;
    if (reason._tag === "Die")
      die ??= reason;
  }
  if (die !== undefined)
    return die.defect;
  if (self.reasons.length > 0)
    return new globalThis.Error("All fibers interrupted without error");
  return new globalThis.Error("Empty cause");
};
var causePrettyErrors = (self, options) => {
  const errors = [];
  const interrupts = [];
  if (self.reasons.length === 0)
    return errors;
  const prevStackLimit = getStackTraceLimit();
  if (prevStackLimit !== 0)
    setStackTraceLimit(1);
  try {
    for (const failure of self.reasons) {
      if (failure._tag === "Interrupt") {
        interrupts.push(failure);
        continue;
      }
      errors.push(causePrettyError(failure._tag === "Die" ? failure.defect : failure.error, failure.annotations, options));
    }
    if (errors.length === 0) {
      const cause = new Error("The fiber was interrupted by:");
      cause.name = "InterruptCause";
      cause.stack = interruptCauseStack(cause, interrupts);
      const error = new globalThis.Error("All fibers interrupted without error", {
        cause
      });
      error.name = "InterruptError";
      error.stack = `${error.name}: ${error.message}`;
      errors.push(causePrettyError(error, interrupts[0].annotations, options));
    }
  } finally {
    if (prevStackLimit !== 0)
      setStackTraceLimit(prevStackLimit);
  }
  return errors;
};
var causePrettyError = (original, annotations, options, seen = new Set) => {
  const kind = typeof original;
  let error;
  if (original && kind === "object") {
    seen.add(original);
    const cause = original.cause;
    error = new globalThis.Error(causePrettyMessage(original), {
      cause: cause !== undefined && !seen.has(cause) ? causePrettyError(cause, undefined, undefined, seen) : undefined
    });
    if (typeof original.name === "string") {
      error.name = original.name;
    }
    if (typeof original.stack === "string") {
      error.stack = cleanErrorStack(original.stack, error, annotations);
    } else {
      const stack = `${error.name}: ${error.message}`;
      error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
    }
    if (options?.includeCauseInStack) {
      error.stack = renderPrettyError(error);
    }
    for (const key of Object.keys(original)) {
      if (!(key in error)) {
        error[key] = original[key];
      }
    }
  } else {
    error = new globalThis.Error(!original ? `Unknown error: ${original}` : kind === "string" ? original : formatJson(original));
    const stack = `${error.name}: ${error.message}`;
    error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
  }
  return error;
};
var causePrettyMessage = (u) => {
  if (typeof u.message === "string") {
    return u.message;
  } else if (typeof u.toString === "function" && u.toString !== Object.prototype.toString && u.toString !== Array.prototype.toString) {
    try {
      return u.toString();
    } catch {}
  }
  return formatJson(u);
};
var locationRegExp = /\((.*)\)/g;
var cleanErrorStack = (stack, error, annotations) => {
  const message = `${error.name}: ${error.message}`;
  const lines = (stack.startsWith(message) ? stack.slice(message.length) : stack).split(`
`);
  const out = [message];
  for (let i = 1;i < lines.length; i++) {
    if (/Generator\.next|~effect\/(?:Effect|Utils)/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return annotations ? addStackAnnotations(out.join(`
`), annotations) : out.join(`
`);
};
var addStackAnnotations = (stack, annotations) => {
  const frame = annotations?.get(StackTraceKey.key);
  if (frame) {
    stack = `${stack}
${currentStackTrace(frame)}`;
  }
  return stack;
};
var interruptCauseStack = (error, interrupts) => {
  const out = [`${error.name}: ${error.message}`];
  for (const current of interrupts) {
    const fiberId = current.fiberId !== undefined ? `#${current.fiberId}` : "unknown";
    const frame = current.annotations.get(InterruptorStackTrace.key);
    out.push(`    at fiber (${fiberId})`);
    if (frame)
      out.push(currentStackTrace(frame));
  }
  return out.join(`
`);
};
var currentStackTrace = (frame) => {
  const out = [];
  let current = frame;
  let i = 0;
  while (current && i < 10) {
    const stack = current.stack();
    if (stack) {
      const locationMatchAll = stack.matchAll(locationRegExp);
      let match = false;
      for (const [, location2] of locationMatchAll) {
        match = true;
        out.push(`    at ${current.name} (${location2})`);
      }
      if (!match) {
        out.push(`    at ${current.name} (${stack.replace(/^at /, "")})`);
      }
    } else {
      out.push(`    at ${current.name}`);
    }
    current = current.parent;
    i++;
  }
  return out.join(`
`);
};
var causePretty = (cause) => causePrettyErrors(cause).map(renderPrettyError).join(`
`);
var renderPrettyError = (e) => e.cause ? `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}` : e.stack;
var renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
};
var FiberTypeId = "~effect/Fiber";
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var AsyncResource = /* @__PURE__ */ (() => {
  try {
    return globalThis.process?.getBuiltinModule?.("node:async_hooks")?.AsyncResource;
  } catch {
    return;
  }
})();
var captureAsyncContext = () => AsyncResource === undefined ? undefined : new AsyncResource("effect/Fiber");
var getCurrentFiber = () => globalThis[currentFiberTypeId];

class FiberImpl {
  constructor(context, interruptible = true) {
    this.setContext(context);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.interruptible = interruptible;
    this._stack = [];
    this._observers = undefined;
    this._exit = undefined;
    this._children = undefined;
    this._interruptedCause = undefined;
    this._yielded = undefined;
    this._autoYielded = false;
    this._running = false;
    this._deferredInterrupt = false;
    this._parent = undefined;
    this._asyncContext = undefined;
    this.cache.runtimeMetrics?.recordFiberStart(this.context);
  }
  get [FiberTypeId]() {
    return fiberVariance;
  }
  get currentDispatcher() {
    return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
  }
  getRef(ref) {
    return get(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    if (this._observers === undefined) {
      this._observers = [cb];
    } else {
      this._observers.push(cb);
    }
    return () => this.removeObserver(cb);
  }
  removeObserver(cb) {
    if (this._exit || this._observers === undefined)
      return;
    const index = this._observers.indexOf(cb);
    if (index >= 0) {
      this._observers.splice(index, 1);
    }
  }
  interruptUnsafe(fiberId, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId);
    if (this.cache.stackFrame) {
      cause = causeAnnotate(cause, make3(StackTraceKey, this.cache.stackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeAddInterrupts(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      if (this._running) {
        this._deferredInterrupt = true;
      } else {
        this.evaluate(failCause(this._interruptedCause));
      }
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._asyncContext !== undefined) {
      const asyncContext = this._asyncContext;
      this._asyncContext = undefined;
      try {
        return asyncContext.runInAsyncScope(this.evaluate, this, effect);
      } finally {
        asyncContext.emitDestroy();
      }
    } else if (this._yielded !== undefined) {
      const yielded = this._yielded;
      this._yielded = undefined;
      yielded();
    }
    const exit = this.runLoop(effect);
    if (exit === Yield) {
      this._asyncContext = captureAsyncContext();
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== undefined) {
      return this.evaluate(flatMap2(interruptChildren, () => exit));
    }
    this._exit = exit;
    this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    if (this._parent) {
      this._parent._children?.delete(this);
      this._parent = undefined;
    }
    if (this._observers !== undefined) {
      const observers = this._observers;
      this._observers = undefined;
      for (let i = 0;i < observers.length; i++) {
        observers[i](exit);
      }
    }
    this._stack.length = 0;
    this._children = undefined;
    this.context = empty();
    const cache = this.cache;
    if (cache.span !== undefined || cache.stackFrame !== undefined) {
      this.cache = {
        ...cache,
        span: undefined,
        stackFrame: undefined
      };
    }
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    const prevRunning = this._running;
    this._running = true;
    let yielding = false;
    let resuming = this._autoYielded;
    this._autoYielded = false;
    let current = effect;
    this.currentOpCount = resuming ? 1 : 0;
    try {
      while (true) {
        try {
          if (this._deferredInterrupt) {
            this._deferredInterrupt = false;
            current = failCause(this._interruptedCause);
          }
          this.currentOpCount++;
          const cache = this.cache;
          if (!resuming && !yielding && !cache.preventYield && cache.scheduler.shouldYield(this)) {
            yielding = true;
            current = this.yieldNow(current, 0, true);
          } else {
            resuming = false;
            current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this);
          }
          if (current === Yield) {
            const yielded = this._yielded;
            if (ExitTypeId in yielded) {
              this._deferredInterrupt = false;
              this._yielded = undefined;
              return yielded;
            } else if (this._deferredInterrupt) {
              this._yielded = undefined;
              yielded();
              continue;
            }
            return Yield;
          }
        } catch (error) {
          if (!hasProperty(current, evaluate)) {
            return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
          }
          current = exitDie(error);
        }
      }
    } finally {
      this._running = prevRunning;
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol) {
    if (this._deferredInterrupt) {
      this._deferredInterrupt = false;
      return deferredInterruptCont;
    }
    while (true) {
      const op = this._stack.pop();
      if (!op)
        return;
      const all = op[contAll];
      if (all !== undefined) {
        const cont = all.call(op, this);
        if (cont) {
          cont[symbol] = cont;
          return cont;
        }
      }
      if (op[symbol])
        return op;
    }
  }
  succeedWith(value) {
    if ((++this.currentOpCount & maxInlineSteps - 1) === 0) {
      return exitSucceed(value);
    }
    const cont = this.getCont(contA);
    return cont ? cont[contA](value, this) : this.yieldWith(exitSucceed(value));
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  yieldNow(effect, priority = 0, automatic = false) {
    let resumed = false;
    this.currentDispatcher.scheduleTask(() => {
      if (resumed)
        return;
      this._autoYielded = automatic;
      this.evaluate(effect);
    }, priority);
    return this.yieldWith(() => {
      resumed = true;
    });
  }
  children() {
    return this._children ??= new Set;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && hasSameCache(previous, context))
      return;
    const root = context.cacheRoot;
    const cache = root._fiberCache ??= makeFiberContextCache(context);
    if (this.cache?.scheduler !== cache.scheduler) {
      this._dispatcher = undefined;
    }
    this.cache = cache;
  }
  get currentSpanLocal() {
    const span = this.cache.span;
    return span?._tag === "Span" ? span : undefined;
  }
}
var makeFiberContextCache = (context) => {
  const currentTracer = getOrUndefinedUnsafe(context, TracerKey);
  return {
    scheduler: get(context, Scheduler),
    tracer: currentTracer,
    tracerContext: currentTracer ? currentTracer["context"] : undefined,
    tracerEnabled: get(context, TracerEnabled),
    span: getOrUndefinedUnsafe(context, ParentSpanKey),
    logLevel: get(context, CurrentLogLevel),
    minimumLogLevel: get(context, MinimumLogLevel),
    stackFrame: get(context, CurrentStackFrame),
    runtimeMetrics: getOrUndefinedUnsafe(context, FiberRuntimeMetricsKey),
    maxOpsBeforeYield: get(context, MaxOpsBeforeYield),
    preventYield: get(context, PreventSchedulerYield)
  };
};
var deferredInterruptCont = {
  [contA](_value, fiber) {
    return failCause(fiber._interruptedCause);
  },
  [contE](_cause, fiber) {
    return failCause(fiber._interruptedCause);
  }
};
var maxInlineSteps = 32;
var fiberMiddleware = {
  interruptChildren: undefined
};
var fiberStackAnnotations = (fiber) => {
  if (!fiber.cache.stackFrame)
    return;
  const annotations = new Map;
  annotations.set(InterruptorStackTrace.key, fiber.cache.stackFrame);
  return makeUnsafe(annotations);
};
var fiberAwait = (self) => {
  const impl = self;
  if (impl._exit)
    return succeed3(impl._exit);
  return callback((resume) => {
    if (impl._exit)
      return resume(succeed3(impl._exit));
    return sync(self.addObserver((exit) => resume(succeed3(exit))));
  });
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = undefined;
  function loop() {
    let result = iter.next();
    while (!result.done) {
      if (result.value._exit) {
        exits.push(result.value._exit);
        result = iter.next();
        continue;
      }
      cancel = result.value.addObserver((exit) => {
        exits.push(exit);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberJoin = (self) => {
  const impl = self;
  if (impl._exit)
    return impl._exit;
  return callback((resume) => {
    if (impl._exit)
      return resume(impl._exit);
    return sync(self.addObserver(resume));
  });
};
var fiberInterrupt = (self) => withFiber((fiber) => fiberInterruptAs(self, fiber.id));
var fiberInterruptAs = /* @__PURE__ */ dual((args) => hasProperty(args[0], FiberTypeId), (self, fiberId, annotations) => withFiber((parent) => {
  let ann = fiberStackAnnotations(parent);
  ann = ann && annotations ? merge(ann, annotations) : ann ?? annotations;
  self.interruptUnsafe(fiberId, ann);
  return asVoid(fiberAwait(self));
}));
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  let fiberArr = empty2();
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
    fiberArr.push(fiber);
  }
  return asVoid(fiberAwaitAll(fiberArr));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber) {
    const thunk = this[args];
    const value = thunk();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    const thunk = this[args];
    return thunk();
  }
});
var fromResult = /* @__PURE__ */ match2({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber) {
    return fiber.yieldNow(exitVoid, this[args] ?? 0);
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var succeedNone = /* @__PURE__ */ succeed3(/* @__PURE__ */ none2());
var failCauseSync = (evaluate) => suspend(() => failCause(evaluate()));
var die = (defect) => exitDie(defect);
var void_2 = /* @__PURE__ */ succeed3(undefined);
var try_2 = (options) => {
  const evaluate = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(evaluate());
    } catch (err) {
      return fail3(catcher(err));
    }
  });
};
var promise = (evaluate) => callbackOptions(function(resume, signal) {
  evaluate(signal).then((a) => resume(succeed3(a)), (e) => resume(die(e)));
}, evaluate.length !== 0);
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => suspend(() => {
      try {
        return fail3(internalCall(() => catcher(cause)));
      } catch (err) {
        return die(err);
      }
    });
    try {
      f(signal).then((a) => resume(succeed3(a)), (e) => resume(failWithCatch(e)));
    } catch (err) {
      resume(failWithCatch(err));
    }
  }, f.length !== 0);
};
var callbackOptions = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Async",
    [evaluate](fiber) {
      let resumed = false;
      let yielded = false;
      const controller = this.withSignal ? new AbortController : undefined;
      const onCancel = this.register.call(fiber.cache.scheduler, (effect) => {
        if (resumed)
          return;
        resumed = true;
        if (yielded) {
          fiber.evaluate(effect);
        } else {
          yielded = effect;
        }
      }, controller?.signal);
      if (yielded !== false)
        return yielded;
      yielded = true;
      fiber.yieldWith(() => {
        resumed = true;
      });
      if (controller === undefined && onCancel === undefined) {
        return Yield;
      }
      fiber._stack.push(asyncFinalizer(() => {
        resumed = true;
        controller?.abort();
        return onCancel ?? exitVoid;
      }));
      return Yield;
    }
  });
  const AsyncImpl = function(register, withSignal) {
    this.register = register;
    this.withSignal = withSignal;
  };
  AsyncImpl.prototype = Proto;
  return function(register, withSignal) {
    return new AsyncImpl(register, withSignal);
  };
}();
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap2(combineFinalizerCause(exitFailCause(cause), this[args]()), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var never = /* @__PURE__ */ callback(constVoid);
var gen = (...args) => {
  if (args.length === 1) {
    const body = args[0];
    return suspend(() => fromIteratorUnsafe(body()));
  }
  const [options, body] = args;
  return suspend(() => fromIteratorUnsafe(body.call(options.self)));
};
var fnBody = (bodyOrOptions, pipeables) => typeof bodyOrOptions === "function" ? bodyOrOptions : pipeables.shift().bind(bodyOrOptions.self);
var fnUntraced = (bodyOrOptions, ...pipeables) => {
  const body = fnBody(bodyOrOptions, pipeables);
  const fn = pipeables.length === 0 ? function() {
    return suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
  } : function() {
    let effect = suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
    for (let i = 0;i < pipeables.length; i++) {
      effect = pipeables[i](effect, ...arguments);
    }
    return effect;
  };
  return defineFunctionLength(body.length, fn);
};
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
  value: length,
  configurable: true
});
var fnStackCleaner = /* @__PURE__ */ makeStackCleaner(2);
var fn = function() {
  const nameFirst = typeof arguments[0] === "string";
  const name = nameFirst ? arguments[0] : "Effect.fn";
  const spanOptions = nameFirst ? arguments[1] : undefined;
  const prevLimit = getStackTraceLimit();
  let defError;
  if (prevLimit !== 0) {
    setStackTraceLimit(2);
    defError = new globalThis.Error;
    setStackTraceLimit(prevLimit);
  }
  if (nameFirst) {
    return (body, ...pipeables) => makeFn(name, body, defError, pipeables, nameFirst, spanOptions);
  }
  return makeFn(name, arguments[0], defError, Array.prototype.slice.call(arguments, 1), nameFirst, spanOptions);
};
var makeFn = (name, bodyOrOptions, defError, pipeables, addSpan, spanOptions) => {
  const body = fnBody(bodyOrOptions, pipeables);
  const definitionName = `${name} (definition)`;
  const definitionStack = defError ? fnStackCleaner(() => defError.stack) : constUndefined;
  const makeCallFrame = (callError) => (prev) => ({
    name,
    stack: callError ? fnStackCleaner(() => callError.stack) : constUndefined,
    parent: {
      name: definitionName,
      stack: definitionStack,
      parent: prev
    }
  });
  return defineFunctionLength(body.length, function(...args) {
    let result = suspend(() => {
      const iter = body.apply(this, arguments);
      return isEffect(iter) ? iter : fromIteratorUnsafe(iter);
    });
    for (let i = 0;i < pipeables.length; i++) {
      result = pipeables[i](result, ...args);
    }
    if (!isEffect(result)) {
      return result;
    }
    const prevLimit = getStackTraceLimit();
    let callError;
    if (prevLimit !== 0) {
      setStackTraceLimit(2);
      callError = new globalThis.Error;
      setStackTraceLimit(prevLimit);
    }
    return updateService(addSpan ? useSpan(name, spanOptions, (span) => provideParentSpan(result, span)) : result, CurrentStackFrame, makeCallFrame(callError));
  });
};
var fnUntracedEager = (bodyOrOptions, ...pipeables) => {
  const body = fnBody(bodyOrOptions, pipeables);
  return defineFunctionLength(body.length, pipeables.length === 0 ? function() {
    return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  } : function() {
    let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
    for (const pipeable of pipeables) {
      effect = pipeable(effect, ...arguments);
    }
    return effect;
  });
};
var fromIteratorEagerUnsafe = (evaluate) => {
  try {
    const iterator = evaluate();
    let value = undefined;
    while (true) {
      const state = iterator.next(value);
      if (state.done) {
        return succeed3(state.value);
      }
      const primitive = state.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap2(state.value, (value) => fromIteratorUnsafe(iterator, value));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Iterator",
    [contA](value, fiber) {
      const iter = this.iterator;
      while (true) {
        const state = iter.next(value);
        if (state.done)
          return succeed3(state.value);
        if (!effectIsExit(state.value)) {
          fiber._stack.push(this);
          return state.value;
        } else if (state.value._tag === "Failure") {
          return state.value;
        }
        value = state.value.value;
      }
    },
    [evaluate](fiber) {
      return this[contA](this.initial, fiber);
    }
  });
  const IteratorImpl = function(iterator, initial) {
    this.iterator = iterator;
    this.initial = initial;
  };
  IteratorImpl.prototype = Proto;
  return function(iterator, initial) {
    return new IteratorImpl(iterator, initial);
  };
}();
var as = /* @__PURE__ */ dual(2, (self, value) => new ContImpl(self, returnPayload, succeed3(value)));
var evaluateCont = function(fiber) {
  fiber._stack.push(this);
  return this[args];
};
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate]: evaluateCont
});
var ContImpl = function(self, cont, payload) {
  this[args] = self;
  this[contA] = cont;
  this.payload = payload;
};
ContImpl.prototype = OnSuccessProto;
var returnPayload = function() {
  return this.payload;
};
var succeedPayload = function(_value, fiber) {
  return fiber.succeedWith(this.payload);
};
var continuationMarksStack = /* @__PURE__ */ (() => {
  const limit = /* @__PURE__ */ getStackTraceLimit();
  if (limit === 0)
    return false;
  const marker = "~effect/Effect/stackProbe";
  const probe = {
    [marker]: function stackProbe() {
      return new Error;
    }
  };
  setStackTraceLimit(1);
  const error = /* @__PURE__ */ probe[marker]();
  setStackTraceLimit(limit);
  return error.stack?.includes("[as " + marker + "]") === true;
})();
var mapCont = function(value, fiber) {
  const f = this.payload;
  return fiber.succeedWith(continuationMarksStack ? f(value) : internalCall(() => f(value)));
};
var andThenCont = function(value) {
  const f = this.payload;
  return f(value);
};
var tapCont = function(value) {
  const f = this.payload;
  return new ContImpl(f(value), succeedPayload, value);
};
var tapEffectCont = function(value) {
  return new ContImpl(this.payload, succeedPayload, value);
};
var asSome = (self) => map4(self, some2);
var andThen = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? returnPayload : andThenCont, f));
var tap = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? tapEffectCont : tapCont, f));
var asVoid = (self) => new ContImpl(self, returnPayload, exitVoid);
var raceAllFirst = (all, options) => withFiber((parent) => {
  const fibers = new Set;
  onExitUnsafe(parent, () => fibers.size === 0 ? undefined : fiberInterruptAll(fibers));
  return callback((resume) => {
    let done = false;
    let i = 0;
    for (const effect of all) {
      if (done)
        break;
      const index = i++;
      const fiber = forkUnsafe(parent, effect, true, true, false);
      fibers.add(fiber);
      fiber.addObserver((exit) => {
        fibers.delete(fiber);
        const isWinner = !done;
        done = true;
        resume(exit);
        if (isWinner) {
          interruptRaceLosers(fibers, parent);
          options?.onWinner?.({
            fiber,
            index,
            parentFiber: parent
          });
        }
      });
    }
  });
});
var interruptRaceLosers = (fibers, parent) => {
  const annotations = fiberStackAnnotations(parent);
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
  }
};
var raceFirst = /* @__PURE__ */ dual((args) => isEffect(args[1]), (self, that, options) => raceAllFirst([self, that], options));
var flatMap2 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, andThenCont, f));
var effectIsExit = (effect) => effect[ExitTypeId] !== undefined;
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap2(self, f);
});
var map4 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, mapCont, f));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map4(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError(self, f));
var exitInterrupt = (fiberId) => exitFailCause(causeInterrupt(fiberId));
var exitIsSuccess = (self) => self._tag === "Success";
var exitFilterCause = (self) => self._tag === "Failure" ? succeed2(self.cause) : fail2(self);
var exitHasInterrupts = (self) => self._tag === "Failure" && hasInterrupts(self.cause);
var exitVoid = /* @__PURE__ */ exitSucceed(undefined);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success")
    return self;
  return exitFailCause(causeMap(self.cause, f));
});
var exitZipRight = /* @__PURE__ */ dual(2, (self, that) => exitIsSuccess(self) ? that : self);
var exitAsVoidAll = (exits) => {
  const failures = [];
  for (const exit of exits) {
    if (exit._tag === "Failure") {
      failures.push(...exit.cause.reasons);
    }
  }
  return failures.length === 0 ? exitVoid : exitFailCause(causeFromReasons(failures));
};
var serviceOption = (service) => withFiber((fiber) => succeed3(getOption(fiber.context, service)));
var updateContext = /* @__PURE__ */ dual(2, (self, f) => withFiber((fiber) => {
  const prevContext = fiber.context;
  const nextContext = f(prevContext);
  if (prevContext === nextContext)
    return self;
  fiber.setContext(nextContext);
  onExitUnsafe(fiber, () => {
    fiber.setContext(prevContext);
    return;
  });
  return self;
}));
var updateService = /* @__PURE__ */ dual(3, (self, service, f) => updateContext(self, (s) => {
  const prev = getUnsafe(s, service);
  const next = f(prev);
  if (prev === next)
    return s;
  return add(s, service, next);
}));
var context = () => getContext;
var getContext = /* @__PURE__ */ withFiber((fiber) => succeed3(fiber.context));
var contextWith = (f) => withFiber((fiber) => f(fiber.context));
var provideContext = /* @__PURE__ */ dual(2, (self, context) => {
  if (effectIsExit(self))
    return self;
  return updateContext(self, merge(context));
});
var provideService = function() {
  if (arguments.length === 1) {
    return dual(2, (self, impl) => provideServiceImpl(self, arguments[0], impl));
  }
  return dual(3, (self, service, impl) => provideServiceImpl(self, service, impl)).apply(this, arguments);
};
var provideServiceImpl = (self, service, implementation) => updateContext(self, add(service, implementation));
var replicate = /* @__PURE__ */ dual(2, (self, n) => Array.from({
  length: n
}, () => self));
var replicateEffect = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, n, options) => all(replicate(self, n), options));
var forever = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => whileLoop({
  while: constTrue,
  body: constant(options?.disableYield ? self : flatMap2(self, (_) => yieldNow)),
  step: constVoid
}));
var catchCause = /* @__PURE__ */ dual(2, (self, f) => new OnFailureImpl(self, f.length !== 1 ? (cause) => f(cause) : f));
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate]: evaluateCont
});
var OnFailureImpl = function(self, f) {
  this[args] = self;
  this[contE] = f;
};
OnFailureImpl.prototype = OnFailureProto;
var catchCauseFilter = /* @__PURE__ */ dual(3, (self, filter, f) => catchCause(self, (cause) => {
  const eb = filter(cause);
  return isFailure2(eb) ? failCause(eb.failure) : f(eb.success, cause);
}));
var catch_ = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findRecoverableError, (e) => f(e)));
var tapCause = /* @__PURE__ */ dual(2, (self, f) => catchCause(self, (cause) => andThen(f(cause), failCause(cause))));
var tapCauseFilter = /* @__PURE__ */ dual(3, (self, filter, f) => catchCause(self, (cause) => {
  const result = filter(cause);
  if (isFailure2(result)) {
    return failCause(cause);
  }
  return andThen(f(result.success, cause), failCause(cause));
}));
var tapError = /* @__PURE__ */ dual(2, (self, f) => tapCauseFilter(self, findError, (e) => f(e)));
var mapError = /* @__PURE__ */ dual(2, (self, f) => catchCause(self, (cause) => failCause(causeMap(cause, f))));
var orDie = (self) => catch_(self, die);
var orElseSucceed = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => sync(() => f(error))));
var ignoreCauseLogger = (log) => log === "Unhandled" ? (...message) => withFiber((fiber) => {
  const level = fiber.getRef(UnhandledLogLevel);
  return level === undefined ? void_2 : logWithLevel(level)(...message);
}) : logWithLevel(log === true ? undefined : log);
var ignore = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => {
  if (!options?.log) {
    return matchEffect(self, {
      onFailure: (_) => void_2,
      onSuccess: (_) => void_2
    });
  }
  const logEffect = ignoreCauseLogger(options.log);
  return matchCauseEffect(self, {
    onFailure(cause) {
      const error = findRecoverableError(cause);
      return isFailure2(error) ? failCause(error.failure) : options.message === undefined ? logEffect(cause) : logEffect(options.message, cause);
    },
    onSuccess: (_) => void_2
  });
});
var ignoreCause = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => {
  if (!options?.log) {
    return matchCauseEffect(self, {
      onFailure: (_) => void_2,
      onSuccess: (_) => void_2
    });
  }
  const logEffect = ignoreCauseLogger(options.log);
  return matchCauseEffect(self, {
    onFailure: (cause) => options.message === undefined ? logEffect(cause) : logEffect(options.message, cause),
    onSuccess: (_) => void_2
  });
});
var result = (self) => matchEager(self, {
  onFailure: fail2,
  onSuccess: succeed2
});
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => new OnSuccessAndFailureImpl(self, options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess, options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure));
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate]: evaluateCont
});
var OnSuccessAndFailureImpl = function(self, onSuccess, onFailure) {
  this[args] = self;
  this[contA] = onSuccess;
  this[contE] = onFailure;
};
OnSuccessAndFailureImpl.prototype = OnSuccessAndFailureProto;
var matchSuccess = function(value, fiber) {
  const handlers = this.payload;
  return fiber.succeedWith(continuationMarksStack ? handlers.onSuccess(value) : internalCall(() => handlers.onSuccess(value)));
};
var makeMatch = (op, onFailure) => {
  const Proto = makePrimitiveProto({
    op,
    [evaluate]: evaluateCont,
    [contA]: matchSuccess,
    [contE]: onFailure
  });
  const MatchImpl = function(self, handlers) {
    this[args] = self;
    this.payload = handlers;
  };
  MatchImpl.prototype = Proto;
  return MatchImpl;
};
var MatchImpl = /* @__PURE__ */ makeMatch("Match", function(cause, fiber) {
  const error = findRecoverableError(cause);
  if (isFailure2(error))
    return failCause(error.failure);
  const handlers = this.payload;
  return fiber.succeedWith(continuationMarksStack ? handlers.onFailure(error.success) : internalCall(() => handlers.onFailure(error.success)));
});
var matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause) => {
    const error = findRecoverableError(cause);
    return isFailure2(error) ? failCause(error.failure) : options.onFailure(error.success);
  },
  onSuccess: options.onSuccess
}));
var match4 = /* @__PURE__ */ dual(2, (self, options) => new MatchImpl(self, options));
var matchEager = /* @__PURE__ */ dual(2, (self, options) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return exitSucceed(options.onSuccess(self.value));
    const error = findRecoverableError(self.cause);
    if (isFailure2(error))
      return exitFailCause(error.failure);
    return exitSucceed(options.onFailure(error.success));
  }
  return match4(self, options);
});
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  },
  [contA](value, fiber, exit) {
    return fiber.succeedWith(exit ?? exitSucceed(value));
  },
  [contE](cause, fiber, exit) {
    return fiber.succeedWith(exit ?? exitFailCause(cause));
  }
});
var delay = /* @__PURE__ */ dual(2, (self, duration) => andThen(sleep(duration), self));
var timeoutOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap2(timeoutOption(self, options.duration), (option) => isNone2(option) ? options.orElse() : succeed3(option.value)));
var timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => raceFirst(asSome(self), as(sleep(duration), none2())));
var ScopeTypeId = "~effect/Scope";
var ScopeCloseableTypeId = "~effect/Scope/Closeable";
var scopeTag = /* @__PURE__ */ Service("effect/Scope");
var scopeClose = (self, exit_) => withFiber((fiber) => {
  fiberEnterUninterruptibleUnsafe(fiber);
  return scopeCloseUnsafe(self, exit_) ?? void_2;
});
var scopeCloseUnsafe = (self, exit_) => {
  const state = self.state;
  if (state._tag === "Closed")
    return;
  self.state = {
    _tag: "Closed",
    exit: exit_
  };
  if (self.parent !== undefined) {
    scopeRemoveFinalizerUnsafe(self.parent, self);
  }
  if (state._tag === "Empty")
    return;
  if (state.finalizer !== undefined) {
    return runFinalizer(state.finalizer, exit_);
  }
  const finalizers = state.finalizers;
  if (finalizers.size === 1) {
    return runFinalizer(finalizers.values().next().value, exit_);
  }
  return scopeCloseFinalizers(self, finalizers, exit_);
};
var runFinalizer = (finalizer, exit_) => {
  try {
    return finalizer(exit_);
  } catch (defect) {
    return exitDie(defect);
  }
};
var combineFinalizerCause = (exit_, finalizer) => exitIsSuccess(exit_) ? finalizer : catchCause(finalizer, (cause) => failCause(causeElectDefects(causeCombine(exit_.cause, cause))));
var scopeCloseFinalizers = /* @__PURE__ */ fnUntraced(function* (self, finalizers, exit_) {
  let exits = [];
  const fibers = [];
  const arr = Array.from(finalizers);
  const parent = getCurrentFiber();
  for (let i = arr.length - 1;i >= 0; i--) {
    const [key, finalizer] = arr[i];
    if (self.strategy === "sequential") {
      exits.push(yield* exit(runFinalizer(finalizer, exit_)));
    } else if (key !== parent) {
      fibers.push(forkUnsafe(parent, runFinalizer(finalizer, exit_), true, true, "inherit"));
    }
  }
  if (fibers.length > 0) {
    exits = yield* fiberAwaitAll(fibers);
  }
  return yield* exitAsVoidAll(exits);
});
var scopeFork = (scope, finalizerStrategy) => sync(() => scopeForkUnsafe(scope, finalizerStrategy));
var scopeForkUnsafe = (scope, finalizerStrategy) => {
  const child = makeScope(finalizerStrategy, scope);
  if (scope.state._tag === "Closed") {
    child.state = scope.state;
    return child;
  }
  scopeAddFinalizerUnsafe(scope, child, (exit) => scopeClose(child, exit));
  return child;
};
var scopeAddFinalizerExit = (scope, finalizer) => {
  return suspend(() => {
    if (scope.state._tag === "Closed") {
      return finalizer(scope.state.exit);
    }
    scopeAddFinalizerUnsafe(scope, {}, finalizer);
    return void_2;
  });
};
var scopeAddFinalizer = (scope, finalizer) => scopeAddFinalizerExit(scope, constant(finalizer));
var scopeAddFinalizerUnsafe = (scope, key, finalizer) => {
  if (scope.state._tag === "Empty") {
    scope.state = {
      _tag: "Open",
      finalizerKey: key,
      finalizer,
      finalizers: undefined
    };
  } else if (scope.state._tag === "Open") {
    const state = scope.state;
    if (state.finalizer !== undefined) {
      state.finalizers = new Map([[state.finalizerKey, state.finalizer]]);
      state.finalizerKey = undefined;
      state.finalizer = undefined;
      state.finalizers.set(key, finalizer);
    } else {
      state.finalizers.set(key, finalizer);
    }
  }
};
var scopeRemoveFinalizerUnsafe = (scope, key) => {
  if (scope.state._tag !== "Open")
    return;
  const state = scope.state;
  if (state.finalizerKey === key) {
    scope.state = constScopeEmpty;
  } else if (state.finalizers !== undefined) {
    state.finalizers.delete(key);
    if (state.finalizers.size === 0) {
      scope.state = constScopeEmpty;
    }
  }
};
var scopeMakeUnsafe = (finalizerStrategy) => makeScope(finalizerStrategy, undefined);
var makeScope = (finalizerStrategy = "sequential", parent) => ({
  [ScopeCloseableTypeId]: ScopeCloseableTypeId,
  [ScopeTypeId]: ScopeTypeId,
  strategy: finalizerStrategy,
  parent,
  state: constScopeEmpty
});
var constScopeEmpty = {
  _tag: "Empty"
};
var scopeMake = (finalizerStrategy) => sync(() => scopeMakeUnsafe(finalizerStrategy));
var scope = scopeTag;
var provideScope = /* @__PURE__ */ provideService(scopeTag);
var scoped = (self) => withFiber((fiber) => {
  const prev = fiber.context;
  const scope = scopeMakeUnsafe();
  fiber.setContext(add(fiber.context, scopeTag, scope));
  onExitUnsafe(fiber, (exit) => {
    fiber.setContext(prev);
    return scopeCloseUnsafe(scope, exit);
  });
  return self;
});
var scopedWith = (f) => suspend(() => {
  const scope = scopeMakeUnsafe();
  return onExit(f(scope), (exit) => suspend(() => scopeCloseUnsafe(scope, exit) ?? void_2));
});
var acquireRelease = (acquire, release, options) => contextWith((context) => uninterruptibleMask((restore) => flatMap2(scope, (scope) => tap(options?.interruptible ? restore(acquire) : acquire, (a) => scopeAddFinalizerExit(scope, (exit) => provideContext(release(a, exit), context))))));
var OnExitImpl = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnExit",
    [evaluate](fiber) {
      fiber._stack.push(this);
      return this.effect;
    },
    [contAll](fiber) {
      if (fiber.interruptible && this.interruptible !== true) {
        fiber._stack.push(setInterruptibleTrue);
        fiber.interruptible = false;
      }
    },
    [contA](value, _, exit) {
      exit ??= exitSucceed(value);
      let eff;
      try {
        eff = this.onExit(exit);
      } catch (defect) {
        eff = exitDie(defect);
      }
      return eff ? flatMap2(eff, (_) => exit) : exit;
    },
    [contE](cause, _, exit) {
      exit ??= exitFailCause(cause);
      let eff;
      try {
        eff = this.onExit(exit);
      } catch (defect) {
        eff = exitDie(defect);
      }
      return eff ? flatMap2(combineFinalizerCause(exit, eff), (_) => exit) : exit;
    }
  });
  const OnExitImpl = function(effect, onExit, interruptible) {
    this.effect = effect;
    this.onExit = onExit;
    this.interruptible = interruptible;
  };
  OnExitImpl.prototype = Proto;
  return OnExitImpl;
}();
var onExitPrimitive = (effect, onExit, interruptible) => new OnExitImpl(effect, onExit, interruptible);
var onExitUnsafe = (fiber, f) => {
  fiber._stack.push(new OnExitImpl(undefined, f, undefined));
};
var onExit = /* @__PURE__ */ dual(2, onExitPrimitive);
var ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => onExit(self, (_) => finalizer));
var onExitFilter = /* @__PURE__ */ dual(3, (self, filter, f) => onExit(self, (exit) => {
  const b = filter(exit);
  return isFailure2(b) ? void_2 : f(b.success, exit);
}));
var onError = /* @__PURE__ */ dual(2, (self, f) => onExitFilter(self, exitFilterCause, f));
var onErrorFilter = /* @__PURE__ */ dual(3, (self, filter, f) => onExit(self, (exit) => {
  if (exit._tag !== "Failure") {
    return void_2;
  }
  const result = filter(exit.cause);
  return isFailure2(result) ? void_2 : f(result.success, exit.cause);
}));
var onInterrupt = /* @__PURE__ */ dual(2, (self, finalizer) => onErrorFilter(causeFilterInterruptors, finalizer)(self));
var infiniteTTL = /* @__PURE__ */ constant(Infinity);
var makeCachedUnsafe = (self, ttlMillis) => {
  let expiresAt = 0;
  let exit;
  let current;
  const join = (fiber, run) => {
    run.awaiters++;
    onExitUnsafe(fiber, () => {
      if (--run.awaiters > 0 || run.done)
        return;
      if (current === run)
        current = undefined;
      return fiberInterrupt(run.fiber);
    });
    return fiberJoin(run.fiber);
  };
  return [withFiber((fiber) => {
    if (current !== undefined) {
      return fiber === current.fiber ? fiberJoin(current.fiber) : join(fiber, current);
    }
    if (exit !== undefined && (expiresAt === Infinity || fiber.getRef(ClockRef).currentTimeMillisUnsafe() < expiresAt)) {
      return exit;
    }
    exit = undefined;
    const clock = fiber.getRef(ClockRef);
    const run = {
      fiber: new FiberImpl(fiber.context),
      awaiters: 0,
      done: false
    };
    current = run;
    const joined = join(fiber, run);
    run.fiber.evaluate(onExitPrimitive(self, (exit_) => {
      run.done = true;
      if (current !== run)
        return;
      current = undefined;
      if (exitHasInterrupts(exit_))
        return;
      const duration = ttlMillis(exit_);
      expiresAt = duration === Infinity ? Infinity : clock.currentTimeMillisUnsafe() + duration;
      exit = exit_;
    }));
    return run.fiber._exit ?? joined;
  }), sync(() => {
    current = undefined;
    exit = undefined;
  })];
};
var cached = (self) => sync(() => makeCachedUnsafe(self, infiniteTTL)[0]);
var interrupt = /* @__PURE__ */ withFiber((fiber) => failCause(causeInterrupt(fiber.id)));
var uninterruptible = (self) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return self;
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return self;
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber) {
    fiber.interruptible = this[args];
    if (fiber._interruptedCause && fiber.interruptible) {
      return () => failCause(fiber._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var setInterruptibleFalse = /* @__PURE__ */ setInterruptible(false);
var setFiberInterruptible = (fiber) => {
  fiber.interruptible = true;
  fiber._stack.push(setInterruptibleFalse);
  if (fiber._interruptedCause)
    return failCause(fiber._interruptedCause);
};
var fiberEnterUninterruptibleUnsafe = (fiber) => {
  const impl = fiber;
  if (!impl.interruptible)
    return;
  impl.interruptible = false;
  impl._stack.push(setInterruptibleTrue);
};
var interruptible = (self) => withFiber((fiber) => {
  if (fiber.interruptible)
    return self;
  return setFiberInterruptible(fiber) ?? self;
});
var uninterruptibleMask = (f) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return f(interruptible);
});
var all = (arg, options) => {
  if (isIterable(arg)) {
    return options?.mode === "result" ? forEach(arg, result, options) : forEach(arg, identity, options);
  } else if (options?.discard) {
    return options.mode === "result" ? forEach(Object.values(arg), result, options) : forEach(Object.values(arg), identity, options);
  }
  return suspend(() => map4(forEach(Object.entries(arg), ([key, effect]) => map4(options?.mode === "result" ? result(effect) : effect, (value) => [key, value]), {
    concurrency: options?.concurrency
  }), Object.fromEntries));
};
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var forEach = /* @__PURE__ */ dual((args) => typeof args[1] === "function", (iterable, f, options) => suspend(() => {
  const concurrency = resolveConcurrency(options?.concurrency);
  if (concurrency === 1) {
    return forEachSequential(iterable, f, options);
  }
  const items = fromIterable(iterable);
  let length = items.length;
  if (length === 0) {
    return options?.discard ? void_2 : succeed3([]);
  }
  const out = options?.discard ? undefined : new Array(length);
  const eff = forEachConcurrent({
    f,
    out
  }, items, {
    concurrency
  });
  return eff ? as(eff, out) : succeed3(out);
}));
var forEachSequential = (iterable, f, options) => suspend(() => {
  const out = options?.discard ? undefined : [];
  const iterator = iterable[Symbol.iterator]();
  let state = iterator.next();
  let index = 0;
  return as(whileLoop({
    while: () => !state.done,
    body: () => f(state.value, index++),
    step: (b) => {
      if (out)
        out.push(b);
      state = iterator.next();
    }
  }), out);
});
var resolveConcurrency = (concurrency) => concurrency === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrency ?? 1);
var iterateEager = () => (options) => {
  const onItem = options.onItem;
  const step = options.step;
  const resumeSequential = (state, items, index, end, effect) => flatMap2(exit(effect), (itemExit) => step(state, items[index], itemExit, index) ?? runSequential(state, items, index + 1, end) ?? void_2);
  const runSequential = (state, items, index = 0, end = items.length) => {
    for (;index < end; index++) {
      const item = items[index];
      const effect = onItem(state, item, index);
      if (!effectIsExit(effect)) {
        return resumeSequential(state, items, index, end, effect);
      }
      const terminal = step(state, item, effect, index);
      if (terminal)
        return terminal._tag === "Failure" ? terminal : undefined;
    }
  };
  return runSequential;
};
var iterateConcurrentImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state, items, opts) => {
    let index = 0;
    const end = opts.end ?? items.length;
    const concurrency = opts.concurrency;
    let done = false;
    let parentFiber;
    let fibers;
    let resume;
    let terminal;
    let effect;
    const failDefect = (error) => {
      const defect = exitDie(error);
      terminal = defect;
      done = true;
      return fibers && fibers.size > 0 ? flatMap2(uninterruptible(fiberInterruptAll(Array.from(fibers))), () => terminal ?? defect) : defect;
    };
    const go = () => {
      let paused = false;
      for (;!terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state, item, eff, index);
          if (terminal)
            break;
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            fibers = new Set;
            effect = eff;
            resume = cb;
            let result;
            try {
              result = go();
            } catch (error) {
              return cb(failDefect(error));
            }
            if (result)
              return cb(result);
            return suspend(() => {
              terminal ??= exitVoid;
              return flatMap2(fibers ? fiberInterruptAll(fibers) : void_2, () => terminal?._tag === "Failure" ? terminal : void_2);
            });
          });
        } else {
          effect = undefined;
          const fiber = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber._exit) {
            terminal = step(state, item, fiber._exit, index);
            if (terminal)
              break;
            continue;
          }
          fibers.add(fiber);
          const currentIndex = index;
          fiber.addObserver((exit) => {
            fibers.delete(fiber);
            try {
              if (terminal) {
                if (exit._tag === "Failure") {
                  const reasons = exit.cause.reasons.filter((reason) => reason._tag !== "Interrupt");
                  if (reasons.length > 0) {
                    const cause = causeFromReasons(reasons);
                    terminal = exitFailCause(terminal._tag === "Failure" ? causeElectDefects(causeCombine(terminal.cause, cause)) : cause);
                  }
                }
              } else {
                const result = step(state, item, exit, currentIndex);
                if (result) {
                  terminal = result;
                  go();
                }
              }
              if (paused) {
                const eff = go();
                if (eff)
                  resume(eff);
              } else if (done && fibers.size === 0) {
                resume(terminal ?? void_2);
              }
            } catch (error) {
              resume(failDefect(error));
            }
          });
          if (fibers.size < concurrency)
            continue;
          paused = true;
          index++;
          return;
        }
      }
      done = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_2);
        }
      }
    };
    return go();
  };
};
var iterateConcurrent = () => (options) => iterateConcurrentImpl(options);
var forEachConcurrent = /* @__PURE__ */ iterateConcurrentImpl({
  onItem(state, item, index) {
    return state.f(item, index);
  },
  step(state, _, exit, index) {
    if (exit._tag === "Failure")
      return exit;
    else if (state.out) {
      state.out[index] = exit.value;
    }
  }
});
var Do = /* @__PURE__ */ succeed3({});
var bind2 = /* @__PURE__ */ bind(map4, flatMap2);
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
  const parentRuntime = parent;
  const interruptible = uninterruptible === "inherit" ? parentRuntime.interruptible : !uninterruptible;
  const child = new FiberImpl(parentRuntime.context, interruptible);
  if (!daemon) {
    parentRuntime.children().add(child);
    child._parent = parentRuntime;
  }
  if (immediate) {
    child.evaluate(effect);
  } else {
    child._asyncContext = captureAsyncContext();
    parentRuntime.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  return child;
};
var forkDetach = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => withFiber((fiber) => succeed3(forkUnsafe(fiber, self, options?.startImmediately, true, options?.uninterruptible))));
var fiberScopeFinalizer = (fiber) => () => withFiber((current) => current === fiber ? void_2 : fiberInterrupt(fiber));
var forkIn = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, scope, options) => withFiber((parent) => {
  const fiber = scope.state._tag === "Closed" ? new FiberImpl(parent.context) : forkUnsafe(parent, self, options?.startImmediately, true, options?.uninterruptible);
  if (!fiber._exit) {
    if (scope.state._tag !== "Closed") {
      scopeAddFinalizerUnsafe(scope, fiber, fiberScopeFinalizer(fiber));
      fiber.addObserver(() => scopeRemoveFinalizerUnsafe(scope, fiber));
    } else {
      fiber.interruptUnsafe(parent.id, fiberStackAnnotations(parent));
    }
  }
  return succeed3(fiber);
}));
var runForkWith = (context) => (effect, options) => {
  const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
  fiber.evaluate(effect);
  if (fiber._exit)
    return fiber;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.interruptUnsafe();
    } else {
      const abort = () => fiber.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber);
  }
  return fiber;
};
var fiberRunIn = /* @__PURE__ */ dual(2, (self, scope) => {
  if (self._exit) {
    return self;
  } else if (scope.state._tag === "Closed") {
    self.interruptUnsafe(self.id);
    return self;
  }
  scopeRemoveFinalizerUnsafe(scope, self);
  scopeAddFinalizerUnsafe(scope, self, fiberScopeFinalizer(self));
  self.addObserver(() => scopeRemoveFinalizerUnsafe(scope, self));
  return self;
});
var runFork = /* @__PURE__ */ runForkWith(/* @__PURE__ */ empty());
var runPromiseExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect, options) => {
    const fiber = runFork(effect, options);
    return new Promise((resolve) => {
      fiber.addObserver((exit) => resolve(exit));
    });
  };
};
var runPromiseWith = (context) => {
  const runPromiseExit = runPromiseExitWith(context);
  return (effect, options) => runPromiseExit(effect, options).then((exit) => {
    if (exit._tag === "Failure") {
      throw causeSquash(exit.cause);
    }
    return exit.value;
  });
};
var runPromise = /* @__PURE__ */ runPromiseWith(/* @__PURE__ */ empty());
var runSyncExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect) => {
    if (effectIsExit(effect))
      return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber = runFork(effect, {
      scheduler
    });
    fiber._dispatcher?.flush();
    return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty());
var runSyncWith = (context) => {
  const runSyncExit = runSyncExitWith(context);
  return (effect) => {
    const exit = runSyncExit(effect);
    if (exit._tag === "Failure")
      throw causeSquash(exit.cause);
    return exit.value;
  };
};
var runSync = /* @__PURE__ */ runSyncWith(/* @__PURE__ */ empty());
var succeedTrue = /* @__PURE__ */ succeed3(true);
var succeedFalse = /* @__PURE__ */ succeed3(false);

class Latch {
  waiters = [];
  scheduled = undefined;
  _isOpen;
  constructor(isOpen) {
    this._isOpen = isOpen;
  }
  scheduleUnsafe(fiber) {
    if (this.waiters.length === 0) {
      return succeedTrue;
    }
    if (this.scheduled === undefined) {
      this.scheduled = this.waiters;
      fiber.currentDispatcher.scheduleTask(this.flushScheduled, 0);
    } else {
      for (let i = 0;i < this.waiters.length; i++) {
        this.scheduled.push(this.waiters[i]);
      }
    }
    this.waiters = [];
    return succeedTrue;
  }
  flushScheduled = () => {
    if (this.scheduled === undefined)
      return;
    const waiters = this.scheduled;
    this.scheduled = undefined;
    for (let i = 0;i < waiters.length; i++) {
      waiters[i](exitVoid);
    }
  };
  flushWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    this.flushScheduled();
    for (let i = 0;i < waiters.length; i++) {
      waiters[i](exitVoid);
    }
  }
  open = /* @__PURE__ */ withFiber((fiber) => {
    if (this._isOpen)
      return succeedFalse;
    this._isOpen = true;
    return this.scheduleUnsafe(fiber);
  });
  release = /* @__PURE__ */ withFiber((fiber) => this._isOpen ? succeedFalse : this.scheduleUnsafe(fiber));
  openUnsafe() {
    if (this._isOpen)
      return false;
    this._isOpen = true;
    this.flushWaiters();
    return true;
  }
  await = /* @__PURE__ */ callback((resume) => {
    if (this._isOpen) {
      return resume(void_2);
    }
    this.waiters.push(resume);
    return sync(() => {
      let index = this.waiters.indexOf(resume);
      if (index !== -1) {
        this.waiters.splice(index, 1);
      } else if (this.scheduled !== undefined) {
        index = this.scheduled.indexOf(resume);
        if (index !== -1) {
          this.scheduled.splice(index, 1);
        }
      }
    });
  });
  closeUnsafe() {
    if (!this._isOpen)
      return false;
    this._isOpen = false;
    return true;
  }
  close = /* @__PURE__ */ sync(() => this.closeUnsafe());
  whenOpen = (self) => flatMap2(this.await, () => self);
  isOpen() {
    return this._isOpen;
  }
}
var makeLatchUnsafe = (open) => new Latch(open ?? false);
var bigint02 = /* @__PURE__ */ BigInt(0);
var NoopSpanProto = {
  _tag: "Span",
  spanId: "noop",
  traceId: "noop",
  sampled: false,
  status: {
    _tag: "Ended",
    startTime: bigint02,
    endTime: bigint02,
    exit: exitVoid
  },
  attributes: /* @__PURE__ */ new Map,
  links: [],
  kind: "internal",
  attribute() {},
  event() {},
  end() {},
  addLinks() {}
};
var noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);
var filterDisablePropagation = (span) => {
  if (!span)
    return none2();
  return get(span.annotations, DisablePropagation) ? span._tag === "Span" ? filterDisablePropagation(getOrUndefined(span.parent)) : none2() : some2(span);
};
var makeSpanUnsafe = (fiber, name, options) => {
  const disablePropagation = !fiber.cache.tracerEnabled || options?.annotations && get(options.annotations, DisablePropagation);
  const parent = options?.parent !== undefined ? some2(options.parent) : options?.root ? none2() : filterDisablePropagation(fiber.cache.span);
  let span;
  if (disablePropagation) {
    span = noopSpan({
      name,
      parent,
      annotations: add(options?.annotations ?? empty(), DisablePropagation, true)
    });
  } else {
    const tracer = fiber.cache.tracer ?? nativeTracer;
    const clock = fiber.getRef(ClockRef);
    const timingEnabled = fiber.getRef(TracerTimingEnabled);
    const annotationsFromEnv = fiber.getRef(TracerSpanAnnotations);
    const linksFromEnv = fiber.getRef(TracerSpanLinks);
    const level = options?.level ?? fiber.getRef(CurrentTraceLevel);
    const links = options?.links !== undefined ? [...linksFromEnv, ...options.links] : linksFromEnv.length === 0 ? [] : linksFromEnv.slice();
    span = tracer.span({
      name,
      parent,
      annotations: options?.annotations ?? empty(),
      links,
      startTime: timingEnabled ? clock.currentTimeNanosUnsafe() : bigint02,
      kind: options?.kind ?? "internal",
      root: options?.root ?? false,
      sampled: options?.sampled ?? (isSome2(parent) && parent.value.sampled === false ? false : !isLogLevelGreaterThan(fiber.getRef(MinimumTraceLevel), level))
    });
    for (const key in annotationsFromEnv) {
      span.attribute(key, annotationsFromEnv[key]);
    }
    if (options?.attributes !== undefined) {
      for (const key in options.attributes) {
        span.attribute(key, options.attributes[key]);
      }
    }
  }
  return span;
};
var makeSpanScoped = (name, options) => uninterruptible(withFiber((fiber) => {
  const scope = getUnsafe(fiber.context, scopeTag);
  const span = makeSpanUnsafe(fiber, name, options ?? {});
  const clock = fiber.getRef(ClockRef);
  const timingEnabled = fiber.getRef(TracerTimingEnabled);
  return as(scopeAddFinalizerExit(scope, (exit) => endSpan(span, exit, clock, timingEnabled)), span);
}));
var provideSpanStackFrame = (name, stack) => {
  stack = typeof stack === "function" ? stack : constUndefined;
  return updateService(CurrentStackFrame, (parent) => ({
    name,
    stack,
    parent
  }));
};
var endSpan = (span, exit, clock, timingEnabled) => sync(() => {
  if (span.status._tag === "Ended")
    return;
  span.end(timingEnabled ? clock.currentTimeNanosUnsafe() : bigint02, exit);
});
var useSpan = (name, ...args) => {
  const options = args.length === 1 ? undefined : args[0];
  const evaluate = args[args.length - 1];
  return withFiber((fiber) => {
    const span = makeSpanUnsafe(fiber, name, options);
    const clock = fiber.getRef(ClockRef);
    const timingEnabled = fiber.getRef(TracerTimingEnabled);
    onExitUnsafe(fiber, (exit) => endSpan(span, exit, clock, timingEnabled));
    return evaluate(span);
  });
};
var provideParentSpan = /* @__PURE__ */ provideService(ParentSpan);
var withParentSpan = function() {
  const dataFirst = isEffect(arguments[0]);
  const span = dataFirst ? arguments[1] : arguments[0];
  let options = dataFirst ? arguments[2] : arguments[1];
  let provideStackFrame = identity;
  if (span._tag === "Span") {
    options = addSpanStackTrace(options);
    provideStackFrame = provideSpanStackFrame(span.name, options?.captureStackTrace);
  }
  if (dataFirst) {
    return provideParentSpan(provideStackFrame(arguments[0]), span);
  }
  return (self) => provideParentSpan(provideStackFrame(self), span);
};
var ClockRef = /* @__PURE__ */ Reference("effect/Clock", {
  defaultValue: () => new ClockImpl
});
var MAX_TIMER_MILLIS = 2 ** 31 - 1;

class ClockImpl {
  currentTimeMillisUnsafe() {
    return Date.now();
  }
  currentTimeMillis = /* @__PURE__ */ sync(() => this.currentTimeMillisUnsafe());
  currentTimeNanosUnsafe() {
    return wallTimeNanos();
  }
  currentTimeNanos = /* @__PURE__ */ sync(() => this.currentTimeNanosUnsafe());
  monotonicTimeNanosUnsafe() {
    return monotonicNowNanos();
  }
  monotonicTimeNanos = /* @__PURE__ */ sync(() => this.monotonicTimeNanosUnsafe());
  sleep(duration) {
    return this.sleepMillis(toMillis(duration));
  }
  sleepMillis(millis) {
    if (millis <= 0)
      return yieldNow;
    else if (!Number.isFinite(millis))
      return never;
    return callback((resume) => {
      const continuation = millis > MAX_TIMER_MILLIS ? this.sleepMillis(millis - MAX_TIMER_MILLIS) : void_2;
      const handle = setTimeout(() => resume(continuation), Math.min(millis, MAX_TIMER_MILLIS));
      return sync(() => clearTimeout(handle));
    });
  }
}
var nanosPerMilli = /* @__PURE__ */ BigInt(1e6);
var monotonicNowNanos = /* @__PURE__ */ function() {
  const processHrtime = globalThis.process?.hrtime;
  if (typeof processHrtime?.bigint === "function") {
    return () => processHrtime.bigint();
  }
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => BigInt(Math.round(performance.now() * 1e6));
  }
  let previous = /* @__PURE__ */ BigInt(0);
  return () => {
    const current = BigInt(Date.now()) * nanosPerMilli;
    if (current > previous) {
      previous = current;
    }
    return previous;
  };
}();
var wallTimeNanos = /* @__PURE__ */ function() {
  const reanchorThresholdNanos = /* @__PURE__ */ BigInt(1e9);
  let origin;
  return () => {
    const monotonic = monotonicNowNanos();
    const wall = BigInt(Date.now()) * nanosPerMilli;
    if (origin === undefined) {
      origin = wall - monotonic;
    } else {
      const projected = origin + monotonic;
      const skew = wall > projected ? wall - projected : projected - wall;
      if (skew > reanchorThresholdNanos) {
        origin = wall - monotonic;
      }
    }
    return origin + monotonic;
  };
}();
var clockWith = (f) => withFiber((fiber) => f(fiber.getRef(ClockRef)));
var sleep = (duration) => clockWith((clock) => clock.sleep(fromInputUnsafe(duration)));
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
class AsyncFiberError extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber
    });
  }
}
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
class UnknownError extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
}
var ConsoleRef = /* @__PURE__ */ Reference("effect/Console", {
  defaultValue: () => globalThis.console
});
var logLevelToOrder = (level) => {
  switch (level) {
    case "All":
      return Number.MIN_SAFE_INTEGER;
    case "Fatal":
      return 50000;
    case "Error":
      return 40000;
    case "Warn":
      return 30000;
    case "Info":
      return 20000;
    case "Debug":
      return 1e4;
    case "Trace":
      return 0;
    case "None":
      return Number.MAX_SAFE_INTEGER;
  }
};
var LogLevelOrder = /* @__PURE__ */ mapInput(Number2, logLevelToOrder);
var isLogLevelGreaterThan = /* @__PURE__ */ isGreaterThan(LogLevelOrder);
var CurrentLoggers = /* @__PURE__ */ Reference("effect/Logger/CurrentLoggers", {
  defaultValue: () => new Set([defaultLogger, tracerLogger])
});
var LogToStderr = /* @__PURE__ */ Reference("effect/Logger/LogToStderr", {
  defaultValue: constFalse
});
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var loggerMake = (log) => {
  const self = Object.create(LoggerProto);
  self.log = log;
  return self;
};
var formatLabel = (key) => key.replace(/[\s="]/g, "_");
var formatLogSpan = (self, now) => {
  const label = formatLabel(self[0]);
  return `${label}=${now - self[1]}ms`;
};
var logWithLevel = (level) => (...message) => {
  let cause = undefined;
  for (let i = 0, len = message.length;i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause) {
        message.splice(i, 1);
      } else {
        message = message.slice(0, i).concat(message.slice(i + 1));
      }
      cause = cause ? causeFromReasons(cause.reasons.concat(msg.reasons)) : msg;
      i--;
    }
  }
  if (cause === undefined) {
    cause = causeEmpty;
  }
  return withFiber((fiber) => {
    const logLevel = level ?? fiber.cache.logLevel;
    if (isLogLevelGreaterThan(fiber.cache.minimumLogLevel, logLevel)) {
      return void_2;
    }
    const clock = fiber.getRef(ClockRef);
    const loggers = fiber.getRef(CurrentLoggers);
    if (loggers.size > 0) {
      const date = new Date(clock.currentTimeMillisUnsafe());
      for (const logger of loggers) {
        logger.log({
          cause,
          fiber,
          date,
          logLevel,
          message
        });
      }
    }
    return void_2;
  });
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};
var defaultDateFormat = (date) => `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
var defaultLogger = /* @__PURE__ */ loggerMake(({
  cause,
  date,
  fiber,
  logLevel,
  message
}) => {
  const message_ = Array.isArray(message) ? message.slice() : [message];
  if (cause.reasons.length > 0) {
    message_.push(causePretty(cause));
  }
  const now = date.getTime();
  const spans = fiber.getRef(CurrentLogSpans);
  let spanString = "";
  for (const span of spans) {
    spanString += ` ${formatLogSpan(span, now)}`;
  }
  const annotations = fiber.getRef(CurrentLogAnnotations);
  if (Object.keys(annotations).length > 0) {
    message_.push(annotations);
  }
  const console = fiber.getRef(ConsoleRef);
  const log = fiber.getRef(LogToStderr) ? console.error : console.log;
  log(`[${defaultDateFormat(date)}] ${logLevel.toUpperCase()} (#${fiber.id})${spanString}:`, ...message_);
});
var tracerLogger = /* @__PURE__ */ loggerMake(({
  cause,
  fiber,
  logLevel,
  message
}) => {
  const clock = fiber.getRef(ClockRef);
  const annotations = fiber.getRef(CurrentLogAnnotations);
  const span = fiber.cache.span;
  if (span === undefined || span._tag === "ExternalSpan" || span.status._tag === "Ended")
    return;
  const attributes = {};
  for (const [key, value] of Object.entries(annotations)) {
    assignProperty(attributes, key, value);
  }
  attributes["effect.fiberId"] = fiber.id;
  attributes["effect.logLevel"] = logLevel.toUpperCase();
  if (cause.reasons.length > 0) {
    attributes["effect.cause"] = causePretty(cause);
  }
  span.event(toStringUnknown(Array.isArray(message) && message.length === 1 ? message[0] : message), clock.currentTimeNanosUnsafe(), attributes);
});
var undefined_ = /* @__PURE__ */ succeed3(undefined);

// ../../node_modules/effect/dist/Cause.js
var isFailReason2 = isFailReason;
var fromReasons = causeFromReasons;
var fail4 = causeFail;
var die2 = causeDie;
var interrupt2 = causeInterrupt;
var makeDieReason = (defect) => new Die(defect);
var hasInterruptsOnly2 = hasInterruptsOnly;
var map5 = causeMap;
var combine2 = causeCombine;
var squash = causeSquash;
var hasInterrupts2 = hasInterrupts;
var isDone2 = isDone;
var done2 = done;
var reasonAnnotations2 = reasonAnnotations;

// ../../node_modules/effect/dist/Exit.js
var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail5 = exitFail;
var void_3 = exitVoid;
var isSuccess3 = exitIsSuccess;

// ../../node_modules/effect/dist/Deferred.js
var TypeId5 = "~effect/Deferred";
var DeferredProto = {
  [TypeId5]: {
    _A: identity,
    _E: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var DeferredImpl = function() {
  this.resumes = undefined;
  this.effect = undefined;
};
DeferredImpl.prototype = DeferredProto;
var makeUnsafe2 = () => new DeferredImpl;
var _await = (self) => callback((resume) => {
  if (self.effect)
    return resume(self.effect);
  self.resumes ??= [];
  self.resumes.push(resume);
  return sync(() => {
    const resumes = self.resumes;
    if (resumes === undefined)
      return;
    const index = resumes.indexOf(resume);
    if (index >= 0)
      resumes.splice(index, 1);
  });
});
var isDoneUnsafe = (self) => self.effect !== undefined;
var doneUnsafe = (self, effect) => {
  if (self.effect)
    return false;
  self.effect = effect;
  if (self.resumes) {
    const resumes = self.resumes;
    self.resumes = undefined;
    for (let i = 0;i < resumes.length; i++) {
      resumes[i](effect);
    }
  }
  return true;
};

// ../../node_modules/effect/dist/References.js
var TracerTimingEnabled2 = TracerTimingEnabled;

// ../../node_modules/effect/dist/Scope.js
var Scope = scopeTag;
var make6 = scopeMake;
var makeUnsafe3 = scopeMakeUnsafe;
var provide = provideScope;
var addFinalizerExit = scopeAddFinalizerExit;
var addFinalizer = scopeAddFinalizer;
var fork = scopeFork;
var forkUnsafe2 = scopeForkUnsafe;
var close = scopeClose;

// ../../node_modules/effect/dist/Layer.js
var TypeId6 = "~effect/Layer";
var MemoMapTypeId = "~effect/Layer/MemoMap";
var makeMemoMapEntry = (memoMap, layer) => {
  const entry = {
    observers: 0,
    deferred: makeUnsafe2(),
    scope: makeUnsafe3(),
    finalizer: (exit) => suspend(() => {
      if (--entry.observers > 0)
        return void_2;
      memoMap.map.delete(layer);
      return close(entry.scope, exit);
    })
  };
  return entry;
};
var memoMapObserve = (entry, scope) => {
  if (scope.state._tag === "Closed")
    return false;
  entry.observers++;
  scopeAddFinalizerUnsafe(scope, {}, entry.finalizer);
  return true;
};
var LayerProto = {
  [TypeId6]: {
    _ROut: identity,
    _E: identity,
    _RIn: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromBuildUnsafe = (build) => {
  const self = Object.create(LayerProto);
  self.build = build;
  return self;
};
var fromBuild = (build) => fromBuildUnsafe((memoMap, scope) => {
  const layerScope = forkUnsafe2(scope);
  return onExit(build(memoMap, layerScope), (exit) => exit._tag === "Failure" ? close(layerScope, exit) : void_2);
});
var fromBuildMemo = (build) => {
  const self = fromBuild((memoMap, scope) => memoMap.getOrElseMemoize(self, scope, build));
  return self;
};

class MemoMapImpl {
  get [MemoMapTypeId]() {
    return MemoMapTypeId;
  }
  parent;
  constructor(parent) {
    this.parent = parent;
  }
  map = /* @__PURE__ */ new Map;
  get(layer, scope) {
    const local = this.map.get(layer);
    if (local) {
      memoMapObserve(local, scope);
      return local.deferred.effect ?? _await(local.deferred);
    }
    return this.parent?.get(layer, scope);
  }
  getOrElseMemoize(layer, scope, build) {
    return suspend(() => {
      let deferred;
      return onExitPrimitive(suspend(() => {
        const existing = this.get(layer, scope);
        if (existing)
          return existing;
        const entry = makeMemoMapEntry(this, layer);
        if (!memoMapObserve(entry, scope))
          return build(this, scope);
        deferred = entry.deferred;
        this.map.set(layer, entry);
        return build(this, entry.scope);
      }), (exit) => {
        if (deferred)
          doneUnsafe(deferred, exit);
      });
    });
  }
}
var makeMemoMapUnsafe = () => new MemoMapImpl;
var forkMemoMapUnsafe = (parent) => new MemoMapImpl(parent);
class CurrentMemoMap extends (/* @__PURE__ */ Service()("effect/Layer/CurrentMemoMap")) {
  static forkOrCreate(self) {
    const current = getOrUndefined2(self, CurrentMemoMap);
    return current ? forkMemoMapUnsafe(current) : makeMemoMapUnsafe();
  }
}
var buildWithMemoMap = /* @__PURE__ */ dual(3, (self, memoMap, scope) => provideService(map4(suspend(() => self.build(memoMap, scope)), add(CurrentMemoMap, memoMap)), CurrentMemoMap, memoMap));
var buildWithScope = /* @__PURE__ */ dual(2, (self, scope) => withFiber((fiber) => buildWithMemoMap(self, CurrentMemoMap.forkOrCreate(fiber.context), scope)));
var succeed5 = function() {
  if (arguments.length === 1) {
    return (resource) => succeedContext(make3(arguments[0], resource));
  }
  return succeedContext(make3(arguments[0], arguments[1]));
};
var succeedContext = (context) => fromBuildUnsafe(constant(succeed3(context)));
var effect = function() {
  if (arguments.length === 1) {
    return (effect) => effectImpl(arguments[0], effect);
  }
  return effectImpl(arguments[0], arguments[1]);
};
var effectImpl = (service, effect) => effectContext(map4(effect, (value) => make3(service, value)));
var effectContext = (effect) => fromBuildMemo((_, scope) => provide(effect, scope));
var mergeAllEffect = (layers, memoMap, scope) => {
  const parentScope = forkUnsafe2(scope, "parallel");
  return forEach(layers, (layer) => layer.build(memoMap, forkUnsafe2(parentScope, "sequential")), {
    concurrency: layers.length
  }).pipe(map4((context) => mergeAll(...context)));
};
var mergeAll2 = (...layers) => fromBuildMemo((memoMap, scope) => mergeAllEffect(layers, memoMap, scope));
var merge2 = /* @__PURE__ */ dual(2, (self, that) => mergeAll2(self, ...Array.isArray(that) ? that : [that]));
var provideWith = (self, that, f) => fromBuildMemo((memoMap, scope) => flatMap2(Array.isArray(that) ? mergeAllEffect(that, memoMap, scope) : that.build(memoMap, scope), (context) => self.build(memoMap, scope).pipe(provideContext(context), map4((merged) => f(merged, context)))));
var provide2 = /* @__PURE__ */ dual(2, (self, that) => provideWith(self, that, identity));

// ../../node_modules/effect/dist/Clock.js
var Clock = ClockRef;

// ../../node_modules/effect/dist/Pull.js
var catchDone = /* @__PURE__ */ dual(2, (effect, f) => catchCauseFilter(effect, filterDoneLeftover, (l) => f(l)));
var isDoneCause = (cause) => cause.reasons.some(isDoneFailure);
var isDoneFailure = (failure) => failure._tag === "Fail" && isDone2(failure.error);
var filterDone = (cause) => {
  let done;
  let hasFailure = false;
  for (const reason of cause.reasons) {
    if (isDoneFailure(reason)) {
      done ??= reason.error;
    } else if (reason._tag !== "Interrupt") {
      hasFailure = true;
    }
  }
  if (done === undefined)
    return fail2(cause);
  return hasFailure ? fail2(fromReasons(cause.reasons.filter((reason) => !isDoneFailure(reason)))) : succeed2(done);
};
var filterDoneLeftover = (cause) => {
  const done = filterDone(cause);
  return isFailure2(done) ? done : succeed2(done.success.value);
};
var doneExitFromCause = (cause) => {
  const halt = filterDone(cause);
  return !isFailure2(halt) ? succeed4(halt.success.value) : failCause2(halt.failure);
};
var matchEffect2 = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onSuccess: options.onSuccess,
  onFailure: (cause) => {
    const halt = filterDone(cause);
    return !isFailure2(halt) ? options.onDone(halt.success.value) : options.onFailure(halt.failure);
  }
}));

// ../../node_modules/effect/dist/Schedule.js
var TypeId7 = "~effect/Schedule";
var CurrentMetadata = /* @__PURE__ */ Reference("effect/Schedule/CurrentMetadata", {
  defaultValue: /* @__PURE__ */ constant({
    input: undefined,
    output: undefined,
    duration: zero,
    attempt: 0,
    start: 0,
    now: 0,
    elapsed: 0,
    elapsedSincePrevious: 0
  })
});
var ScheduleProto = {
  [TypeId7]: {
    _Out: identity,
    _In: identity,
    _Env: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isSchedule = (u) => hasProperty(u, TypeId7);
var fromStep = (step) => {
  const self = Object.create(ScheduleProto);
  self.step = step;
  return self;
};
var metadataFn = () => {
  let n = 0;
  let previous;
  let start;
  return (now, input) => {
    if (start === undefined)
      start = now;
    const elapsed = now - start;
    const elapsedSincePrevious = previous === undefined ? 0 : now - previous;
    previous = now;
    return {
      input,
      attempt: ++n,
      start,
      now,
      elapsed,
      elapsedSincePrevious
    };
  };
};
var fromStepWithMetadata = (step) => fromStep(map4(step, (f) => {
  const meta = metadataFn();
  return (now, input) => f(meta(now, input));
}));
var toStep = (schedule) => catchCause(schedule.step, (cause) => succeed3(() => failCause(cause)));
var toStepWithMetadata = (schedule) => clockWith((clock) => map4(toStep(schedule), (step) => {
  const metaFn = metadataFn();
  return (input) => suspend(() => {
    const now = clock.currentTimeMillisUnsafe();
    return flatMap2(step(now, input), ([output, duration]) => {
      const meta = metaFn(now, input);
      meta.output = output;
      meta.duration = duration;
      return as(sleep(duration), meta);
    });
  });
}));
var exponential = (base, factor = 2) => {
  const baseMillis = toMillis(fromInputUnsafe(base));
  return fromStepWithMetadata(succeed3((meta) => {
    const duration = millis(baseMillis * Math.pow(factor, meta.attempt - 1));
    return succeed3([duration, duration]);
  }));
};
var passthrough = (self) => fromStep(map4(toStep(self), (step) => (now, input) => matchEffect2(step(now, input), {
  onSuccess: (result) => succeed3([input, result[1]]),
  onFailure: failCause,
  onDone: () => done2(input)
})));
var spaced = (duration) => {
  const decoded = fromInputUnsafe(duration);
  return fromStepWithMetadata(succeed3((meta) => succeed3([meta.attempt - 1, decoded])));
};
var while_ = /* @__PURE__ */ dual(2, (self, predicate) => fromStep(map4(toStep(self), (step) => {
  const meta = metadataFn();
  return (now, input) => flatMap2(step(now, input), (result) => {
    const [output, duration] = result;
    const eff = predicate({
      ...meta(now, input),
      output,
      duration
    });
    return flatMap2(isEffect(eff) ? eff : succeed3(eff), (check) => check ? succeed3(result) : done2(output));
  });
})));
var forever2 = /* @__PURE__ */ spaced(zero);

// ../../node_modules/effect/dist/internal/layer.js
var provideLayer = (self, layer, options) => scopedWith((scope) => flatMap2(options?.local ? buildWithMemoMap(layer, makeMemoMapUnsafe(), scope) : buildWithScope(layer, scope), (context) => provideContext(self, context)));
var provide3 = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, source, options) => isContext(source) ? provideContext(self, source) : provideLayer(self, Array.isArray(source) ? mergeAll2(...source) : source, options));

// ../../node_modules/effect/dist/internal/schedule.js
var repeatOrElse = /* @__PURE__ */ dual(3, (self, schedule, orElse) => flatMap2(toStepWithMetadata(schedule), (step) => {
  let meta = CurrentMetadata.defaultValue();
  const loop = (input) => matchEffect2(step(input), {
    onSuccess(meta_) {
      meta = meta_;
      return flatMap2(provideService(self, CurrentMetadata, meta), loop);
    },
    onFailure: failCause,
    onDone: succeed3
  });
  return catchCauseFilter(flatMap2(provideService(self, CurrentMetadata, meta), loop), findRecoverableError, (error) => orElse(error, meta.attempt === 0 ? none2() : some2(meta)));
}));
var retryOrElse = /* @__PURE__ */ dual(3, (self, policy, orElse) => flatMap2(toStepWithMetadata(policy), (step) => {
  let meta = CurrentMetadata.defaultValue();
  let lastError;
  const loop = catchCauseFilter(suspend(() => provideService(self, CurrentMetadata, meta)), findRecoverableError, (error) => {
    lastError = error;
    return flatMap2(step(error), (meta_) => {
      meta = meta_;
      return loop;
    });
  });
  return catchDone(loop, (out) => internalCall(() => orElse(lastError, out)));
}));
var repeat = /* @__PURE__ */ dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : isSchedule(options) ? options : buildFromOptions(options);
  return repeatOrElse(self, schedule, fail3);
});
var retry = /* @__PURE__ */ dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : isSchedule(options) ? options : buildFromOptions(options);
  return retryOrElse(self, schedule, fail3);
});
var passthroughForever = /* @__PURE__ */ passthrough(forever2);
var buildFromOptions = (options) => {
  let schedule = options.schedule ? passthrough(options.schedule) : passthroughForever;
  if (options.while) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.while(input);
      return isEffect(applied) ? applied : succeed3(applied);
    });
  }
  if (options.until) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.until(input);
      return isEffect(applied) ? map4(applied, (b) => !b) : succeed3(!applied);
    });
  }
  if (options.times !== undefined) {
    schedule = while_(schedule, ({
      attempt
    }) => succeed3(attempt <= options.times));
  }
  return schedule;
};

// ../../node_modules/effect/dist/Effect.js
var isEffect2 = isEffect;
var all2 = all;
var forEach2 = forEach;
var whileLoop2 = whileLoop;
var promise2 = promise;
var tryPromise2 = tryPromise;
var succeed6 = succeed3;
var suspend2 = suspend;
var sync2 = sync;
var void_4 = void_2;
var undefined_2 = undefined_;
var callback2 = callback;
var Do2 = Do;
var bind3 = bind2;
var gen2 = gen;
var fail6 = fail3;
var failCause3 = failCause;
var failCauseSync2 = failCauseSync;
var die3 = die;
var try_3 = try_2;
var withFiber2 = withFiber;
var fromResult2 = fromResult;
var flatMap3 = flatMap2;
var andThen2 = andThen;
var tap2 = tap;
var exit2 = exit;
var map6 = map4;
var as2 = as;
var asVoid2 = asVoid;
var catchCause2 = catchCause;
var mapError2 = mapError;
var orDie2 = orDie;
var tapError2 = tapError;
var tapCause2 = tapCause;
var retry2 = retry;
var ignore2 = ignore;
var ignoreCause2 = ignoreCause;
var orElseSucceed2 = orElseSucceed;
var timeoutOrElse2 = timeoutOrElse;
var delay2 = delay;
var raceFirst2 = raceFirst;
var matchCauseEffect2 = matchCauseEffect;
var context2 = context;
var contextWith2 = contextWith;
var provide4 = provide3;
var provideContext2 = provideContext;
var serviceOption2 = serviceOption;
var updateContext2 = updateContext;
var provideService2 = provideService;
var scope2 = scope;
var scoped2 = scoped;
var acquireRelease2 = acquireRelease;
var ensuring2 = ensuring;
var onError2 = onError;
var onExitPrimitive2 = onExitPrimitive;
var onExit2 = onExit;
var cached2 = cached;
var interrupt3 = interrupt;
var interruptible2 = interruptible;
var onInterrupt2 = onInterrupt;
var uninterruptible2 = uninterruptible;
var uninterruptibleMask2 = uninterruptibleMask;
var forever3 = forever;
var repeat2 = repeat;
var replicateEffect2 = replicateEffect;
var makeSpanScoped2 = makeSpanScoped;
var useSpan2 = useSpan;
var withParentSpan2 = withParentSpan;
var forkIn2 = forkIn;
var forkDetach2 = forkDetach;
var runFork2 = runFork;
var runForkWith2 = runForkWith;
var runPromise2 = runPromise;
var runSync2 = runSync;
var runSyncExit2 = runSyncExit;
var fnUntraced2 = fnUntraced;
var fn2 = fn;
var log = /* @__PURE__ */ logWithLevel();
var logError = /* @__PURE__ */ logWithLevel("Error");
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var flatMapEager2 = flatMapEager;
var fnUntracedEager2 = fnUntracedEager;

// ../../node_modules/effect/dist/Runtime.js
class InterruptExitCode extends (/* @__PURE__ */ Service()("effect/Runtime/InterruptExitCode")) {
}
var defaultTeardown = (exit, onExit) => {
  if (isSuccess3(exit))
    return onExit(0);
  if (hasInterruptsOnly2(exit.cause)) {
    let code = -Infinity;
    for (const reason of exit.cause.reasons) {
      const annotated = getOrUndefined2(reasonAnnotations2(reason), InterruptExitCode);
      if (annotated === undefined)
        return onExit(130);
      code = Math.max(code, annotated);
    }
    return onExit(code);
  }
  return onExit(getErrorExitCode(squash(exit.cause)));
};
var makeRunMain = (f) => dual((args) => isEffect2(args[0]), (effect, options) => {
  const main = options?.disableErrorReporting === true ? effect : tapCause2(effect, (cause) => {
    if (hasInterruptsOnly2(cause))
      return void_4;
    const isReported = getErrorReported(squash(cause));
    return isReported ? logError(cause) : void_4;
  });
  const teardown = options?.teardown ?? defaultTeardown;
  runFork2(withFiber2((fiber) => {
    try {
      const keepAlive = globalThis.setInterval(constVoid, 2147483647);
      fiber.addObserver(() => {
        clearInterval(keepAlive);
      });
    } catch {}
    f({
      fiber,
      teardown
    });
    return main;
  }));
});
var errorExitCode = "~effect/Runtime/errorExitCode";
var getErrorExitCode = (u) => {
  if (typeof u === "object" && u !== null && errorExitCode in u) {
    const code = u[errorExitCode];
    if (typeof code === "number") {
      return code;
    }
  }
  return 1;
};
var errorReported = "~effect/Runtime/errorReported";
var getErrorReported = (u) => {
  if (typeof u === "object" && u !== null && errorReported in u) {
    const isReported = u[errorReported];
    if (typeof isReported === "boolean") {
      return isReported;
    }
  }
  return true;
};

// ../../node_modules/@effect/platform-node-shared/dist/NodeRuntime.js
var runMain = /* @__PURE__ */ makeRunMain(({
  fiber,
  teardown
}) => {
  let receivedSignal = false;
  fiber.addObserver((exit) => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    teardown(exit, (code) => {
      if (receivedSignal || code !== 0) {
        process.exit(code);
      }
    });
  });
  function onSigint() {
    receivedSignal = true;
    fiber.interruptUnsafe(fiber.id);
  }
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);
});

// ../../node_modules/@effect/platform-node/dist/NodeRuntime.js
var runMain2 = runMain;
// ../../node_modules/effect/dist/Fiber.js
var interrupt4 = fiberInterrupt;
var runIn = fiberRunIn;

// ../../node_modules/effect/dist/Latch.js
var makeUnsafe4 = makeLatchUnsafe;

// ../../node_modules/effect/dist/MutableRef.js
var TypeId8 = "~effect/MutableRef";
var MutableRefProto = {
  [TypeId8]: TypeId8,
  ...PipeInspectableProto,
  toJSON() {
    return {
      _id: "MutableRef",
      current: toJson(this.current)
    };
  }
};
var make7 = (value) => {
  const ref = Object.create(MutableRefProto);
  ref.current = value;
  return ref;
};

// ../../node_modules/effect/dist/MutableList.js
var Empty = /* @__PURE__ */ Symbol.for("effect/MutableList/Empty");
var make8 = () => ({
  head: undefined,
  tail: undefined,
  length: 0
});
var compactHead = (self) => {
  const head = self.head;
  if (head.offset >= 1024 && head === self.tail && head.mutable && (head.array.length - head.offset) * 8 <= head.offset) {
    self.head = self.tail = {
      array: head.array.slice(head.offset),
      mutable: true,
      offset: 0,
      next: undefined
    };
  }
};
var emptyBucket = () => ({
  array: [],
  mutable: true,
  offset: 0,
  next: undefined
});
var append2 = (self, message) => {
  if (!self.tail) {
    self.head = self.tail = emptyBucket();
  } else if (!self.tail.mutable) {
    self.tail.next = emptyBucket();
    self.tail = self.tail.next;
  }
  self.tail.array.push(message);
  self.length++;
};
var clear = (self) => {
  self.head = self.tail = undefined;
  self.length = 0;
};
var takeN = (self, n) => {
  n = normalize(n);
  if (n <= 0 || !self.head)
    return [];
  n = Math.min(n, self.length);
  if (n === self.length && self.head?.offset === 0 && !self.head.next) {
    const array = self.head.array;
    clear(self);
    return array;
  }
  const array = new Array(n);
  let index = 0;
  let chunk = self.head;
  while (chunk) {
    while (chunk.offset < chunk.array.length) {
      array[index++] = chunk.array[chunk.offset];
      if (chunk.mutable)
        chunk.array[chunk.offset] = undefined;
      chunk.offset++;
      if (index === n) {
        self.head = chunk.offset === chunk.array.length && chunk.next ? chunk.next : chunk;
        self.length -= n;
        if (self.length === 0)
          clear(self);
        else
          compactHead(self);
        return array;
      }
    }
    chunk = chunk.next;
  }
  clear(self);
  return array;
};
var takeNVoid = (self, n) => {
  n = normalize(n);
  if (n <= 0 || !self.head)
    return;
  n = Math.min(n, self.length);
  if (n === self.length && self.head?.offset === 0 && !self.head.next) {
    clear(self);
    return;
  }
  let count = 0;
  let chunk = self.head;
  while (chunk) {
    const size = chunk.array.length - chunk.offset;
    if (count + size > n) {
      chunk.offset += n - count;
      self.head = chunk;
      self.length -= n;
      compactHead(self);
      return;
    }
    count += size;
    chunk = chunk.next;
  }
  clear(self);
  return;
};
var take = (self) => {
  if (!self.head)
    return Empty;
  const message = self.head.array[self.head.offset];
  if (self.head.mutable)
    self.head.array[self.head.offset] = undefined;
  self.head.offset++;
  self.length--;
  if (self.head.offset === self.head.array.length) {
    if (self.head.next) {
      self.head = self.head.next;
    } else {
      clear(self);
    }
  } else {
    compactHead(self);
  }
  return message;
};

// ../../node_modules/effect/dist/Queue.js
var TypeId9 = "~effect/Queue";
var EnqueueTypeId = "~effect/Queue/Enqueue";
var DequeueTypeId = "~effect/Queue/Dequeue";
var variance = {
  _A: identity,
  _E: identity
};
var QueueProto = {
  [TypeId9]: variance,
  [EnqueueTypeId]: variance,
  [DequeueTypeId]: variance,
  ...PipeInspectableProto,
  toJSON() {
    return {
      _id: "effect/Queue",
      state: this.state._tag,
      size: sizeUnsafe(this)
    };
  }
};
var make9 = (options) => withFiber((fiber) => {
  const self = Object.create(QueueProto);
  self.dispatcher = fiber.currentDispatcher;
  self.capacity = options?.capacity ?? Number.POSITIVE_INFINITY;
  self.strategy = options?.strategy ?? "suspend";
  self.messages = make8();
  self.scheduleRunning = false;
  self.state = {
    _tag: "Open",
    takers: new Set,
    offers: new Set,
    awaiters: new Set
  };
  return succeed3(self);
});
var bounded = (capacity) => make9({
  capacity
});
var unbounded = () => make9();
var offer = /* @__PURE__ */ dual(2, (self, message) => suspend(() => offerUnsafe(self, message) ? exitTrue : self.state._tag === "Open" && self.strategy === "suspend" ? offerOrWait(self, message) : exitFalse));
var offerUnsafe = (self, message) => {
  if (self.state._tag !== "Open") {
    return false;
  } else if (self.messages.length >= self.capacity) {
    if (self.capacity <= 0 && self.state.takers.size > (self.strategy === "sliding" ? 0 : self.messages.length)) {
      append2(self.messages, message);
      if (self.strategy === "sliding") {
        takeNVoid(self.messages, self.messages.length - self.state.takers.size);
      }
      releaseTakers(self);
      return true;
    } else if (self.strategy === "sliding") {
      if (self.capacity > 0) {
        take(self.messages);
        append2(self.messages, message);
      }
      return true;
    }
    return false;
  }
  append2(self.messages, message);
  scheduleReleaseTaker(self);
  return true;
};
var failCause4 = /* @__PURE__ */ dual(2, (self, cause) => sync(() => failCauseUnsafe(self, cause)));
var failCauseUnsafe = (self, cause) => {
  if (self.state._tag !== "Open") {
    return false;
  }
  const exit = exitFailCause(cause);
  const fail = exitZipRight(exit, exitFailDone);
  if (self.state.offers.size === 0 && self.messages.length === 0) {
    finalize(self, fail);
    return true;
  }
  self.state = {
    ...self.state,
    _tag: "Closing",
    exit: fail
  };
  scheduleReleaseTaker(self);
  return true;
};
var shutdown = (self) => sync(() => shutdownUnsafe(self));
var shutdownUnsafe = (self) => {
  if (self.state._tag === "Done") {
    return false;
  }
  clear(self.messages);
  const offers = self.state.offers;
  finalize(self, self.state._tag === "Open" ? exitInterrupt2 : self.state.exit);
  for (const entry of offers) {
    resumeUnoffered(entry);
  }
  return true;
};
var takeAll2 = (self) => takeBetween(self, 1, Number.POSITIVE_INFINITY);
var takeBetween = /* @__PURE__ */ dual(3, (self, min, max) => {
  min = normalize(min);
  max = normalize(max);
  return suspendTake(() => takeBetweenUnsafe(self, min, max) ?? andThen(awaitTake(self, () => canTake(self, min)), takeBetween(self, min, max)));
});
var take2 = (self) => suspendTake(() => takeUnsafe(self) ?? andThen(awaitTake(self, () => canTake(self, 1)), take2(self)));
var takeUnsafe = (self) => {
  if (self.state._tag === "Done") {
    return self.state.exit;
  }
  if (self.messages.length > 0) {
    const message = take(self.messages);
    releaseCapacity(self);
    return exitSucceed(message);
  } else if (self.capacity <= 0 && self.state.offers.size > 0) {
    const message = takeOfferUnsafe(self.state.offers);
    releaseCapacity(self);
    return exitSucceed(message);
  }
  return;
};
var sizeUnsafe = (self) => self.state._tag === "Done" ? 0 : self.messages.length;
var exitFalse = /* @__PURE__ */ exitSucceed(false);
var exitTrue = /* @__PURE__ */ exitSucceed(true);
var exitFailDone = /* @__PURE__ */ exitFail(/* @__PURE__ */ Done());
var exitInterrupt2 = /* @__PURE__ */ exitInterrupt();
var releaseTakers = (self) => {
  if (self.state._tag === "Done" || self.state.takers.size === 0) {
    return;
  }
  for (const taker of self.state.takers) {
    if (!taker.ready())
      continue;
    self.state.takers.delete(taker);
    taker.resume(exitVoid);
    if (self.messages.length === 0) {
      break;
    }
  }
};
var scheduleReleaseTaker = (self) => {
  if (self.scheduleRunning || self.state._tag === "Done" || self.state.takers.size === 0) {
    return;
  }
  self.scheduleRunning = true;
  self.dispatcher.scheduleTask(() => {
    self.scheduleRunning = false;
    releaseTakers(self);
  }, 0);
};
var takeBetweenUnsafe = (self, min, max) => {
  if (self.state._tag === "Done") {
    return self.state.exit;
  } else if (max <= 0 || min <= 0) {
    return exitSucceed([]);
  } else if (!canTake(self, min)) {
    return;
  }
  const messages = self.messages.length > 0 ? takeN(self.messages, max) : [takeOfferUnsafe(self.state.offers)];
  releaseCapacity(self);
  return exitSucceed(messages);
};
var suspendTake = /* @__PURE__ */ makePrimitive({
  op: "QueueTake",
  [evaluate](fiber) {
    const effect = this[args]();
    return isExit(effect) ? effect[evaluate](fiber) : effect;
  }
});
var canTake = (self, min) => self.messages.length >= (self.state._tag === "Closing" ? 1 : Math.min(min, self.capacity || 1)) || self.capacity <= 0 && self.state._tag !== "Done" && self.state.offers.size > 0;
var awaitTake = (self, ready) => callback((resume) => {
  if (self.state._tag === "Done")
    return resume(self.state.exit);
  if (ready())
    return resume(exitVoid);
  const taker = {
    ready,
    resume
  };
  self.state.takers.add(taker);
  return sync(() => {
    if (self.state._tag !== "Done")
      self.state.takers.delete(taker);
  });
});
var offerOrWait = (self, message) => callback((resume) => offerUnsafe(self, message) ? resume(exitTrue) : waitToOffer(self, {
  _tag: "Single",
  message,
  resume
}));
var waitToOffer = (self, entry) => {
  if (self.state._tag !== "Open")
    return resumeUnoffered(entry);
  const offers = self.state.offers;
  offers.add(entry);
  return sync(() => {
    if (self.state._tag === "Done")
      return;
    offers.delete(entry);
    if (self.state._tag === "Closing" && offers.size === 0 && self.messages.length === 0) {
      finalize(self, self.state.exit);
    }
  });
};
var resumeUnoffered = (entry) => entry._tag === "Single" ? entry.resume(exitFalse) : entry.resume(exitSucceed(entry.remaining.slice(entry.offset)));
var takeOfferUnsafe = (offers) => {
  const entry = offers.values().next().value;
  if (entry._tag === "Single") {
    offers.delete(entry);
    entry.resume(exitTrue);
    return entry.message;
  }
  const message = entry.remaining[entry.offset++];
  if (entry.offset === entry.remaining.length) {
    offers.delete(entry);
    entry.resume(exitSucceed([]));
  }
  return message;
};
var releaseCapacity = (self) => {
  if (self.state._tag === "Done") {
    return isDoneCause(self.state.exit.cause);
  } else if (self.state.offers.size === 0) {
    if (self.state._tag === "Closing" && self.messages.length === 0) {
      finalize(self, self.state.exit);
      return isDoneCause(self.state.exit.cause);
    }
    return false;
  }
  for (const entry of self.state.offers) {
    let n = self.capacity - self.messages.length;
    if (n <= 0)
      break;
    else if (entry._tag === "Single") {
      append2(self.messages, entry.message);
      self.state.offers.delete(entry);
      entry.resume(exitTrue);
    } else {
      for (;entry.offset < entry.remaining.length; entry.offset++) {
        if (n === 0)
          return false;
        append2(self.messages, entry.remaining[entry.offset]);
        n--;
      }
      self.state.offers.delete(entry);
      entry.resume(exitSucceed([]));
    }
    const state = self.state;
    if (state._tag === "Done") {
      return isDoneCause(state.exit.cause);
    }
  }
  return false;
};
var finalize = (self, exit) => {
  if (self.state._tag === "Done") {
    return;
  }
  const openState = self.state;
  self.state = {
    _tag: "Done",
    exit
  };
  for (const taker of openState.takers) {
    taker.resume(exit);
  }
  openState.takers.clear();
  for (const awaiter of openState.awaiters) {
    awaiter(exit);
  }
  openState.awaiters.clear();
};

// ../../node_modules/effect/dist/Semaphore.js
var makeUnsafe5 = (permits) => new SemaphoreImpl(permits);
var firstAvailableWaiter = (self) => {
  for (const waiter of self.waiters) {
    if (waiter.permits <= self.free)
      return waiter;
  }
};
var takePermits = (self, n, onAcquire, restore = identity) => withFiber((fiber) => {
  if (self.free >= n && firstAvailableWaiter(self) === undefined) {
    self.taken += n;
    return onAcquire();
  }
  const waiter = {
    permits: n,
    resume: undefined
  };
  const remove = () => {
    if (self.waiters.delete(waiter))
      self.releaseUnsafe(fiber, 0);
    return;
  };
  self.waiters.add(waiter);
  onExitUnsafe(fiber, remove);
  const wait = restore(callback((resume) => {
    if (firstAvailableWaiter(self) === waiter) {
      resume(void_2);
    } else {
      waiter.resume = resume;
    }
  }));
  const loop = flatMap2(wait, () => {
    if (firstAvailableWaiter(self) !== waiter)
      return loop;
    self.taken += n;
    remove();
    return onAcquire();
  });
  return loop;
});

class SemaphoreImpl {
  waiters = /* @__PURE__ */ new Set;
  taken = 0;
  permits;
  constructor(permits) {
    this.permits = permits;
  }
  get free() {
    return this.permits - this.taken;
  }
  take(n) {
    return takePermits(this, n, () => succeed3(n));
  }
  takeScoped(n) {
    return uninterruptibleMask((restore) => flatMap2(scope, (scope) => takePermits(this, n, () => scopeAddFinalizer(scope, this.release(n)), restore)));
  }
  takeIfAvailable(n) {
    return suspend(() => {
      if (this.free < n)
        return succeed3(false);
      this.taken += n;
      return succeed3(true);
    });
  }
  releaseUnsafe(fiber, n) {
    this.taken -= n;
    if (this.waiters.size > 0) {
      fiber.currentDispatcher.scheduleTask(() => {
        let remaining = this.free;
        for (const waiter of Array.from(this.waiters)) {
          if (!this.waiters.has(waiter) || waiter.permits > remaining)
            continue;
          remaining -= waiter.permits;
          const resume = waiter.resume;
          waiter.resume = undefined;
          resume?.(void_2);
        }
      }, 0);
    }
    return this.free;
  }
  resize(permits) {
    return withFiber((fiber) => {
      this.permits = permits;
      if (this.free < 0)
        return void_2;
      this.releaseUnsafe(fiber, 0);
      return void_2;
    });
  }
  release(n) {
    return withFiber((fiber) => succeed3(this.releaseUnsafe(fiber, n)));
  }
  get releaseAll() {
    return withFiber((fiber) => succeed3(this.releaseUnsafe(fiber, this.taken)));
  }
  withPermits(n) {
    return (self) => uninterruptibleMask((restore) => takePermits(this, n, () => onExitPrimitive(restore(self), () => {
      this.releaseUnsafe(getCurrentFiber(), n);
      return;
    }, true), restore));
  }
  withPermit = /* @__PURE__ */ this.withPermits(1);
  withPermitsIfAvailable(n) {
    return (self) => uninterruptibleMask((restore) => {
      if (this.free < n)
        return succeedNone;
      this.taken += n;
      return onExitPrimitive(restore(asSome(self)), () => {
        this.releaseUnsafe(getCurrentFiber(), n);
        return;
      }, true);
    });
  }
}

// ../../node_modules/effect/dist/Channel.js
var TypeId10 = "~effect/Channel";
var isChannel = (u) => hasProperty(u, TypeId10);
var ChannelProto = {
  [TypeId10]: {
    _Env: identity,
    _InErr: identity,
    _InElem: identity,
    _OutErr: identity,
    _OutElem: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromTransform = (transform) => {
  const self = Object.create(ChannelProto);
  self.transform = (upstream, scope) => catchCause2(transform(upstream, scope), (cause) => succeed6(failCause3(cause)));
  return self;
};
var transformPull = (self, f) => fromTransform((upstream, scope) => flatMap3(toTransform(self)(upstream, scope), (pull) => f(pull, scope)));
var fromPull = (effect) => fromTransform((_, __) => effect);
var fromTransformBracket = (f) => fromTransform(fnUntraced2(function* (upstream, scope) {
  const closableScope = forkUnsafe2(scope);
  const onCause = (cause) => close(closableScope, doneExitFromCause(cause));
  const pull = yield* onError2(f(upstream, scope, closableScope), onCause);
  return onError2(pull, onCause);
}));
var toTransform = (channel) => channel.transform;
var suspend3 = (evaluate) => fromTransform((upstream, scope) => suspend2(() => toTransform(evaluate())(upstream, scope)));
var fail7 = (error) => fromPull(succeed6(fail6(error)));
var fromQueueArray = (queue) => fromPull(succeed6(takeAll2(queue)));
var fromReadableStream = (options) => fromTransform((_, scope) => readableStreamToPullUnsafe({
  scope,
  readable: options.evaluate(),
  onError: options.onError,
  releaseLockOnEnd: options.releaseLockOnEnd
}));
var readableStreamToPullUnsafe = (options) => {
  const reader = options.readable.getReader();
  const exit = options.exit ?? make7(undefined);
  const pull = suspend2(() => {
    if (exit.current)
      return exit.current;
    return matchCauseEffect2(tryPromise2({
      try: () => reader.read(),
      catch: options.onError
    }), {
      onFailure: (cause) => exit.current ?? failCause3(cause),
      onSuccess: ({
        done,
        value
      }) => {
        if (exit.current)
          return exit.current;
        return done ? done2() : succeed6(of(value));
      }
    });
  });
  return as2(addFinalizer(options.scope, options.releaseLockOnEnd ? sync2(() => reader.releaseLock()) : promise2(() => reader.cancel().catch((error) => reader.closed.then(() => Promise.reject(error), constVoid))).pipe(ensuring2(sync2(() => reader.releaseLock())))), pull);
};
var map7 = /* @__PURE__ */ dual(2, (self, f) => transformPull(self, (pull) => sync2(() => {
  let i = 0;
  return map6(pull, (o) => f(o, i++));
})));
var merge3 = /* @__PURE__ */ dual((args) => isChannel(args[0]) && isChannel(args[1]), (left, right, options) => fromTransformBracket(fnUntraced2(function* (upstream, _scope, forkedScope) {
  const strategy = options?.haltStrategy ?? "both";
  const queue = yield* bounded(0);
  yield* addFinalizer(forkedScope, shutdown(queue));
  let done = 0;
  function onExit(side, cause) {
    done++;
    if (!isDoneCause(cause)) {
      return failCause4(queue, cause);
    }
    switch (strategy) {
      case "both": {
        return done === 2 ? failCause4(queue, cause) : void_4;
      }
      case "left":
      case "right": {
        return side === strategy ? failCause4(queue, cause) : void_4;
      }
      case "either": {
        return failCause4(queue, cause);
      }
    }
  }
  const runSide = (side, channel, scope) => toTransform(channel)(upstream, scope).pipe(flatMap3((pull) => pull.pipe(flatMap3((value) => offer(queue, value)), forever3)), onError2((cause) => onExitPrimitive2(doneExitFromCause(cause), (exit) => close(scope, exit)).pipe(matchCauseEffect2({
    onFailure: (cause) => onExit(side, cause),
    onSuccess: () => onExit(side, cause)
  }))), forkIn2(forkedScope));
  yield* runSide("left", left, forkUnsafe2(forkedScope));
  yield* runSide("right", right, forkUnsafe2(forkedScope));
  return take2(queue);
})));
var unwrap = (channel) => fromTransform((upstream, scope) => {
  let pull;
  return succeed6(suspend2(() => {
    if (pull)
      return pull;
    return channel.pipe(provide(scope), flatMap3((channel) => toTransform(channel)(upstream, scope)), flatMap3((pull_) => pull = pull_));
  }));
});
var interruptWhen = /* @__PURE__ */ dual(2, (self, effect) => merge3(self, fromPull(succeed6(flatMap3(effect, done2))), {
  haltStrategy: "either"
}));
var onExit3 = /* @__PURE__ */ dual(2, (self, finalizer) => fromTransformBracket((upstream, scope, forkedScope) => addFinalizerExit(forkedScope, finalizer).pipe(andThen2(toTransform(self)(upstream, scope)))));
var ensuring3 = /* @__PURE__ */ dual(2, (self, finalizer) => onExit3(self, (_) => finalizer));
var runWith = (self, f, onHalt) => suspend2(() => {
  const scope = makeUnsafe3();
  const makePull = toTransform(self)(done2(), scope);
  return catchDone(flatMap3(makePull, f), onHalt ? onHalt : succeed6).pipe(onExit2((exit) => close(scope, exit)));
});
var provideService3 = /* @__PURE__ */ dual(3, (self, key, service) => fromTransform((upstream, scope) => map6(provideService2(toTransform(self)(upstream, scope), key, service), provideService2(key, service))));
var runForEach = /* @__PURE__ */ dual(2, (self, f) => runWith(self, (pull) => forever3(flatMap3(pull, f), {
  disableYield: true
})));
var mkUint8Array = (self) => map6(runFold(self, () => ({
  bytes: 0,
  arrays: []
}), (acc, chunk) => {
  for (let i = 0;i < chunk.length; i++) {
    acc.bytes += chunk[i].length;
    acc.arrays.push(chunk[i]);
  }
  return acc;
}), ({
  arrays,
  bytes
}) => {
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (let i = 0;i < arrays.length; i++) {
    const array = arrays[i];
    result.set(array, offset);
    offset += array.length;
  }
  return result;
});
var runFold = /* @__PURE__ */ dual(3, (self, initial, f) => suspend2(() => {
  let state = initial();
  return runWith(self, (pull) => whileLoop2({
    while: constTrue,
    body: () => pull,
    step: (value) => {
      state = f(state, value);
    }
  }), () => succeed6(state));
}));

// ../../node_modules/effect/dist/internal/stream.js
var TypeId11 = "~effect/Stream";
var streamVariance = {
  _R: identity,
  _E: identity,
  _A: identity
};
var Stream = function(channel) {
  this.channel = channel;
};
Stream.prototype = {
  [TypeId11]: streamVariance,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromChannel = (channel) => new Stream(channel);

// ../../node_modules/effect/dist/Stream.js
var TypeId12 = "~effect/Stream";
var isStream = (u) => hasProperty(u, TypeId12);
var fromChannel2 = fromChannel;
var toChannel = (stream) => stream.channel;
var suspend4 = (stream) => {
  const suspended = fromChannel2(suspend3(() => stream().channel));
  suspendedStreams.set(suspended, stream);
  return suspended;
};
var suspendedStreams = /* @__PURE__ */ new WeakMap;
var fail8 = (error) => fromChannel2(fail7(error));
var fromQueue = (queue) => fromChannel2(fromQueueArray(queue));
var fromReadableStream2 = (options) => fromChannel2(fromReadableStream(options));
var unwrap2 = (effect) => fromChannel2(unwrap(map6(effect, toChannel)));
var mapArray = /* @__PURE__ */ dual(2, (self, f) => fromChannel2(map7(self.channel, f)));
var interruptWhen2 = /* @__PURE__ */ dual(2, (self, effect) => fromChannel2(interruptWhen(self.channel, effect)));
var ensuring4 = /* @__PURE__ */ dual(2, (self, finalizer) => fromChannel2(ensuring3(self.channel, finalizer)));
var provideService4 = /* @__PURE__ */ dual(3, (self, key, service) => fromChannel2(provideService3(self.channel, key, service)));
var mkArrayBuffer = (self) => map6(mkUint8Array(self.channel), (bytes) => bytes.buffer);
var toReadableStreamWith = /* @__PURE__ */ dual((args) => isStream(args[0]), (self, context, options) => {
  let currentResolve = undefined;
  let fiber = undefined;
  let cancelled = false;
  const latch = makeUnsafe4(false);
  const signal = options?.signal;
  const onAbort = () => fiber.interruptUnsafe();
  return new ReadableStream({
    start(controller) {
      fiber = runFork2(provideContext2(runForEach(transformPull(self.channel, (pull) => succeed6(latch.whenOpen(pull))), (chunk) => sync2(() => {
        latch.closeUnsafe();
        for (let i = 0;i < chunk.length; i++) {
          controller.enqueue(chunk[i]);
        }
        currentResolve();
        currentResolve = undefined;
      })), context));
      fiber.addObserver((exit) => {
        signal?.removeEventListener("abort", onAbort);
        if (cancelled)
          return;
        if (exit._tag === "Failure" && signal?.aborted !== true) {
          controller.error(squash(exit.cause));
        } else {
          controller.close();
        }
      });
      if (signal !== undefined && fiber.pollUnsafe() === undefined) {
        if (signal.aborted)
          onAbort();
        else
          signal.addEventListener("abort", onAbort, {
            once: true
          });
      }
    },
    pull() {
      return new Promise((resolve) => {
        currentResolve = resolve;
        latch.openUnsafe();
      });
    },
    cancel() {
      if (!fiber)
        return;
      cancelled = true;
      return runPromise2(asVoid2(interrupt4(fiber)));
    }
  }, options?.strategy);
});
var toReadableStreamEffect = /* @__PURE__ */ dual((args) => isStream(args[0]), (self, options) => map6(context2(), (context) => toReadableStreamWith(self, context, options)));

// ../../node_modules/effect/dist/internal/base64.js
var decodeNative = (str, decodedLength, options) => {
  if (str.length < 128)
    return;
  const NativeUint8Array = Uint8Array;
  if (typeof NativeUint8Array.fromBase64 !== "function")
    return;
  try {
    const bytes = NativeUint8Array.fromBase64(str, options);
    return bytes.length === decodedLength ? bytes : null;
  } catch {
    return null;
  }
};
var stripCrlf = (str) => str.indexOf(`
`) === -1 && str.indexOf("\r") === -1 ? str : str.replace(/[\n\r]/g, "");

// ../../node_modules/effect/dist/encoding/Base64.js
var encode = (input) => encodeBytes(typeof input === "string" ? encoder.encode(input) : input);
var decode = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: "Found a '=' character, but it is not at the end"
    }));
  }
  const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
  const decodedLength = 3 * (length / 4) - missingOctets;
  const native = decodeNative(stripped, decodedLength, undefined);
  if (native)
    return succeed2(native);
  if (native === null) {
    const invalid = invalidCharacter.exec(stripped);
    if (invalid !== null) {
      return fail2(new EncodingError({
        kind: "Decode",
        module: "Base64",
        input: stripped,
        message: `Invalid character ${invalid[0]}`
      }));
    }
  }
  try {
    const result = new Uint8Array(decodedLength);
    for (let i = 0, j = 0;i < length; i += 4, j += 3) {
      const buffer = getCode(stripped.charCodeAt(i)) << 18 | getCode(stripped.charCodeAt(i + 1)) << 12 | getCode(stripped.charCodeAt(i + 2)) << 6 | getCode(stripped.charCodeAt(i + 3));
      result[j] = buffer >> 16;
      result[j + 1] = buffer >> 8 & 255;
      result[j + 2] = buffer & 255;
    }
    return succeed2(result);
  } catch (cause) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: cause instanceof Error ? cause.message : "Invalid input"
    }));
  }
};
var encodeBytes = (bytes) => {
  const length = bytes.length;
  const toBase64 = Uint8Array.prototype.toBase64;
  if (length >= 32 && typeof toBase64 === "function")
    return toBase64.call(bytes);
  return length < 128 ? encodeShort(bytes) : encodeLong(bytes);
};
var encodeShort = (bytes) => {
  const length = bytes.length;
  let result = "";
  let i;
  for (i = 2;i < length; i += 3) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result += alphabet[bytes[i] & 63];
  }
  if (i === length + 1) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4];
    result += "==";
  }
  if (i === length) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2];
    result += "=";
  }
  return result;
};
var encodeLong = (bytes) => {
  const length = bytes.length;
  const result = new Uint8Array(Math.ceil(length / 3) * 4);
  let i;
  let j = 0;
  for (i = 2;i < length; i += 3, j += 4) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result[j + 3] = alphabetCodes[bytes[i] & 63];
  }
  if (i === length + 1) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4];
    result[j + 2] = paddingCode;
    result[j + 3] = paddingCode;
  }
  if (i === length) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2];
    result[j + 3] = paddingCode;
  }
  return decoder.decode(result);
};
var encoder = /* @__PURE__ */ new TextEncoder;
var decoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  ignoreBOM: true
});
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var alphabetCodes = /* @__PURE__ */ encoder.encode(alphabet);
var paddingCode = 61;
var invalidCharacter = /[^A-Za-z0-9+/=]/;
var codes = /* @__PURE__ */ new Uint8Array(123).fill(255);
for (let i = 0;i < alphabet.length; i++)
  codes[/* @__PURE__ */ alphabet.charCodeAt(i)] = i;
codes[61] = 0;
var getCode = (charCode) => {
  if (charCode >= codes.length || codes[charCode] === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return codes[charCode];
};

// ../../node_modules/effect/dist/http/Cookies.js
var TypeId13 = "~effect/http/Cookies";
var CookieTypeId = "~effect/http/Cookies/Cookie";
var Proto2 = {
  [TypeId13]: TypeId13,
  ...BaseProto,
  toJSON() {
    return {
      _id: "effect/Cookies",
      cookies: map2(this.cookies, (cookie) => cookie.toJSON())
    };
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromReadonlyRecord = (cookies) => {
  const self = Object.create(Proto2);
  self.cookies = cookies;
  return self;
};
var fromIterable2 = (cookies) => {
  const record = {};
  for (const cookie of cookies) {
    assignProperty(record, cookie.name, cookie);
  }
  return fromReadonlyRecord(record);
};
var fromSetCookie = (headers) => {
  const arrayHeaders = typeof headers === "string" ? [headers] : headers;
  const cookies = [];
  for (const header of arrayHeaders) {
    const cookie = parseSetCookie(header.trim());
    if (cookie) {
      cookies.push(cookie);
    }
  }
  return fromIterable2(cookies);
};
function parseSetCookie(header) {
  const parts = header.split(";").map((_) => _.trim()).filter((_) => _ !== "");
  if (parts.length === 0) {
    return;
  }
  const firstEqual = parts[0].indexOf("=");
  if (firstEqual === -1) {
    return;
  }
  const name = parts[0].slice(0, firstEqual).replace(cookieWhitespaceRegExp, "");
  if (!cookieNameRegExp.test(name)) {
    return;
  }
  const valueEncoded = parts[0].slice(firstEqual + 1).replace(cookieWhitespaceRegExp, "");
  const value = tryDecodeURIComponent(valueEncoded);
  if (parts.length === 1) {
    return Object.assign(Object.create(CookieProto), {
      name,
      value,
      valueEncoded
    });
  }
  const options = {};
  for (let i = 1;i < parts.length; i++) {
    const part = parts[i];
    const equalIndex = part.indexOf("=");
    const key = equalIndex === -1 ? part : part.slice(0, equalIndex).trim();
    const value = equalIndex === -1 ? undefined : part.slice(equalIndex + 1).trim();
    switch (key.toLowerCase()) {
      case "domain": {
        if (value === undefined) {
          break;
        }
        const domain = value.trim().replace(/^\./, "");
        if (domain) {
          options.domain = domain;
        }
        break;
      }
      case "expires": {
        if (value === undefined) {
          break;
        }
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          options.expires = date;
        }
        break;
      }
      case "max-age": {
        if (value === undefined || !maxAgeRegExp.test(value)) {
          break;
        }
        options.maxAge = seconds(parseInt(value, 10));
        break;
      }
      case "path": {
        if (value === undefined) {
          break;
        }
        if (value[0] === "/") {
          options.path = value;
        }
        break;
      }
      case "priority": {
        if (value === undefined) {
          break;
        }
        switch (value.toLowerCase()) {
          case "low":
            options.priority = "low";
            break;
          case "medium":
            options.priority = "medium";
            break;
          case "high":
            options.priority = "high";
            break;
        }
        break;
      }
      case "httponly": {
        options.httpOnly = true;
        break;
      }
      case "secure": {
        options.secure = true;
        break;
      }
      case "partitioned": {
        options.partitioned = true;
        break;
      }
      case "samesite": {
        if (value === undefined) {
          break;
        }
        switch (value.toLowerCase()) {
          case "lax":
            options.sameSite = "lax";
            break;
          case "strict":
            options.sameSite = "strict";
            break;
          case "none":
            options.sameSite = "none";
            break;
        }
        break;
      }
    }
  }
  return Object.assign(Object.create(CookieProto), {
    name,
    value,
    valueEncoded,
    options: Object.keys(options).length > 0 ? options : undefined
  });
}
var cookieNameRegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
var cookieWhitespaceRegExp = /^[\t ]+|[\t ]+$/g;
var maxAgeRegExp = /^-?[0-9]+$/;
var CookieProto = {
  [CookieTypeId]: CookieTypeId,
  ...BaseProto,
  toJSON() {
    return {
      _id: "effect/Cookies/Cookie",
      name: this.name,
      value: this.value,
      options: this.options
    };
  }
};
var tryDecodeURIComponent = (str) => {
  try {
    return decodeURIComponent(str);
  } catch (_) {
    return str;
  }
};

// ../../node_modules/effect/dist/internal/redacted.js
var redactedRegistry = /* @__PURE__ */ new WeakMap;
var value = (self) => {
  if (redactedRegistry.has(self)) {
    return redactedRegistry.get(self);
  } else {
    throw new Error("Unable to get redacted value" + (self.label ? ` with label: "${self.label}"` : ""));
  }
};

// ../../node_modules/effect/dist/Redacted.js
var TypeId14 = "~effect/Redacted";
var isRedacted = (u) => hasProperty(u, TypeId14);
var make10 = (value, options) => {
  const self = Object.create(Proto3);
  if (options?.label) {
    self.label = options.label;
  }
  redactedRegistry.set(self, value);
  return self;
};
var Proto3 = {
  [TypeId14]: {
    _A: (_) => _
  },
  label: undefined,
  ...PipeInspectableProto,
  toJSON() {
    return this.toString();
  },
  toString() {
    return `<redacted${isString(this.label) ? ":" + this.label : ""}>`;
  },
  [symbol]() {
    return hash(redactedRegistry.get(this));
  },
  [symbol2](that) {
    return isRedacted(that) && equals(redactedRegistry.get(this), redactedRegistry.get(that));
  }
};
var value2 = value;

// ../../node_modules/effect/dist/http/Headers.js
var TypeId15 = /* @__PURE__ */ Symbol.for("~effect/http/Headers");
var Proto4 = /* @__PURE__ */ Object.defineProperties(/* @__PURE__ */ Object.create(null), {
  [TypeId15]: {
    value: TypeId15
  },
  [symbolRedactable]: {
    value(context) {
      return redact2(this, get(context, CurrentRedactedNames));
    }
  },
  toJSON: {
    value() {
      return redact(this);
    }
  },
  [symbol2]: {
    value(that) {
      return Equivalence2(this, that);
    }
  },
  [symbol]: {
    value() {
      return structure(this);
    }
  },
  toString: {
    value: BaseProto.toString
  },
  [NodeInspectSymbol]: {
    value: BaseProto[NodeInspectSymbol]
  }
});
var make11 = (input) => Object.assign(Object.create(Proto4), input);
var Equivalence2 = /* @__PURE__ */ makeEquivalence2(/* @__PURE__ */ strictEqual());
var empty4 = /* @__PURE__ */ Object.create(Proto4);
var fromInput2 = (input) => {
  if (input === undefined) {
    return empty4;
  } else if (Symbol.iterator in input) {
    const out = Object.create(Proto4);
    for (const [k, v] of input) {
      const key = k.toLowerCase();
      out[key] = key in out ? `${out[key]}, ${v}` : v;
    }
    return out;
  }
  const out = Object.create(Proto4);
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) {
      out[k.toLowerCase()] = v.join(", ");
    } else if (v !== undefined) {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
};
var fromRecordUnsafe = (input) => Object.setPrototypeOf(input, Proto4);
var set2 = /* @__PURE__ */ dual(3, (self, key, value) => {
  const out = make11(self);
  out[key.toLowerCase()] = value;
  return out;
});
var setAll = /* @__PURE__ */ dual(2, (self, headers) => make11({
  ...self,
  ...fromInput2(headers)
}));
var merge4 = /* @__PURE__ */ dual(2, (self, headers) => {
  const out = make11(self);
  Object.assign(out, headers);
  return out;
});
var remove2 = /* @__PURE__ */ dual(2, (self, key) => {
  const out = make11(self);
  delete out[key.toLowerCase()];
  return out;
});
var redact2 = /* @__PURE__ */ dual(2, (self, key) => {
  const out = {
    ...self
  };
  const modify = (key) => {
    if (typeof key === "string") {
      const k = key.toLowerCase();
      if (k in self) {
        out[k] = make10(self[k]);
      }
    } else {
      for (const name in self) {
        if (name.search(key) !== -1) {
          out[name] = make10(self[name]);
        }
      }
    }
  };
  if (Array.isArray(key)) {
    for (let i = 0;i < key.length; i++) {
      modify(key[i]);
    }
  } else {
    modify(key);
  }
  return out;
});
var isRedactedName = (name, patterns) => {
  const lowerName = name.toLowerCase();
  for (let i = 0;i < patterns.length; i++) {
    const pattern = patterns[i];
    if (typeof pattern === "string") {
      if (pattern.toLowerCase() === lowerName) {
        return true;
      }
    } else if (name.search(pattern) !== -1) {
      return true;
    }
  }
  return false;
};
var CurrentRedactedNames = /* @__PURE__ */ Reference("effect/Headers/CurrentRedactedNames", {
  defaultValue: () => ["authorization", "cookie", "set-cookie", "x-api-key"]
});

// ../../node_modules/effect/dist/http/internal/urlParams.js
var unwrap3 = (value) => typeof value === "string" ? value : value2(value);
var bodyDecoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  ignoreBOM: true
});
var fromBody = (bytes) => new URLSearchParams(bodyDecoder.decode(bytes).replace(/^\?/, "%3F"));

// ../../node_modules/effect/dist/http/UrlParams.js
var TypeId16 = "~effect/http/UrlParams";
var isUrlParams = (u) => hasProperty(u, TypeId16);
var Proto5 = {
  ...PipeInspectableProto,
  [TypeId16]: TypeId16,
  [Symbol.iterator]() {
    return this.params[Symbol.iterator]();
  },
  [symbolRedactable](context) {
    return {
      _id: "UrlParams",
      params: Object.fromEntries(redact3(this, get(context, CurrentRedactedNames2)))
    };
  },
  toJSON() {
    return redact(this);
  },
  [symbol2](that) {
    return Equivalence3(this, that);
  },
  [symbol]() {
    return array(this.params.flat());
  }
};
var make12 = (params) => {
  const self = Object.create(Proto5);
  self.params = params;
  return self;
};
var fromInput3 = (input) => {
  if (isUrlParams(input)) {
    return input;
  }
  const parsed = fromInputNested(input);
  const out = [];
  for (let i = 0;i < parsed.length; i++) {
    if (Array.isArray(parsed[i][0])) {
      const [keys, value] = parsed[i];
      out.push([`${keys[0]}[${keys.slice(1).join("][")}]`, value]);
    } else {
      out.push(parsed[i]);
    }
  }
  return make12(out);
};
var fromInputNested = (input) => {
  const entries = typeof input[Symbol.iterator] === "function" ? fromIterable(input) : Object.entries(input);
  const out = [];
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (let i = 0;i < value.length; i++) {
        if (value[i] !== undefined) {
          out.push([key, coerce(value[i])]);
        }
      }
    } else if (value !== null && typeof value === "object" && !isRedacted(value)) {
      const nested = fromInputNested(value);
      for (const [k, v] of nested) {
        out.push([[key, ...typeof k === "string" ? [k] : k], v]);
      }
    } else if (value !== undefined) {
      out.push([key, coerce(value)]);
    }
  }
  return out;
};
var coerce = (value) => isRedacted(value) ? value : String(value);
var Equivalence3 = /* @__PURE__ */ make((a, b) => arrayEquivalence(a.params, b.params));
var arrayEquivalence = /* @__PURE__ */ makeEquivalence3(/* @__PURE__ */ makeEquivalence([/* @__PURE__ */ strictEqual(), /* @__PURE__ */ asEquivalence()]));
var empty5 = /* @__PURE__ */ make12([]);
var setAll2 = /* @__PURE__ */ dual(2, (self, input) => {
  const params = fromInput3(input).params.slice();
  const keys = new Set;
  for (let i = 0;i < params.length; i++) {
    keys.add(params[i][0]);
  }
  for (let i = 0;i < self.params.length; i++) {
    if (keys.has(self.params[i][0]))
      continue;
    params.push(self.params[i]);
  }
  return make12(params);
});
var redact3 = /* @__PURE__ */ dual(2, (self, key) => {
  const patterns = Array.isArray(key) ? key : [key];
  return self.params.map(([name, value]) => [name, typeof value === "string" && isRedactedName2(name, patterns) ? make10(value) : value]);
});
var isRedactedName2 = isRedactedName;
var redactUrl = (url, redactedNames = currentRedactedNames()) => {
  if (url.includes("@"))
    url = redactUserinfo(url);
  const queryStart = url.indexOf("?");
  if (queryStart === -1 || redactedNames.length === 0)
    return url;
  const hashStart = url.indexOf("#");
  if (hashStart !== -1 && hashStart < queryStart)
    return url;
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  return url.slice(0, queryStart + 1) + redactQuery(url.slice(queryStart + 1, queryEnd), redactedNames) + url.slice(queryEnd);
};
var authorityStart = /^(?:(https?|ftp|wss?):[/\\]*|[a-z][a-z\d+.-]*:\/\/|[/\\]{2,})/i;
var specialAuthorityEnd = /[/\\?#]/;
var authorityEnd = /[/?#]/;
var redactUserinfo = (url) => {
  let normalized = "";
  const offsets = [];
  for (let i = 0;i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || normalized === "" && code <= 32)
      continue;
    normalized += url[i];
    offsets.push(i);
  }
  const authority = authorityStart.exec(normalized);
  if (authority === null)
    return url;
  const start = authority[0].length;
  const special = authority[1] !== undefined || !authority[0].includes(":");
  const rest = normalized.slice(start);
  const end = rest.search(special ? specialAuthorityEnd : authorityEnd);
  const userinfoEnd = (end === -1 ? rest : rest.slice(0, end)).lastIndexOf("@");
  return userinfoEnd === -1 ? url : url.slice(0, offsets[start]) + "REDACTED:REDACTED" + url.slice(offsets[start + userinfoEnd]);
};
var redactQuery = (query, redactedNames) => query.split("&").map((part) => {
  const index = part.indexOf("=");
  return index !== -1 && isRedactedName2(decodeQueryKey(part.slice(0, index)), redactedNames) ? part.slice(0, index + 1) + "REDACTED" : part;
}).join("&");
var decodeQueryKey = (key) => {
  if (!key.includes("%") && !key.includes("+"))
    return key;
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    return key;
  }
};
var currentRedactedNames = () => get(globalThis[currentFiberTypeId]?.context ?? empty(), CurrentRedactedNames2);
var CurrentRedactedNames2 = /* @__PURE__ */ Reference("effect/http/UrlParams/CurrentRedactedNames", {
  defaultValue: () => ["X-Amz-Signature", "X-Amz-Credential", "X-Amz-Security-Token", "AWSAccessKeyId", "Signature", "sig", "X-Goog-Signature"]
});

// ../../node_modules/effect/dist/internal/schema/annotations.js
function resolve(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var SENTINELS_ANNOTATION_KEY = "~sentinels";
var CONSTRUCTOR_ANNOTATION_KEY = "~constructor";
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier = resolve(ast)?.identifier;
  if (typeof identifier === "string")
    return identifier;
  return ast.getExpected(getExpected);
});

// ../../node_modules/effect/dist/internal/schema/parser.js
var missing = /* @__PURE__ */ Symbol.for("effect/schema/parser/missing");
var succeed8 = succeed4;
var missingExit = /* @__PURE__ */ succeed8(missing);
var sameExit = /* @__PURE__ */ Object.assign(/* @__PURE__ */ succeed8(missing), {
  [missing]: true
});
var isSameExit = (result) => result[missing] === true;
var toOption = (value) => value === missing ? none2() : some2(value);
var fromOptionExit = (option) => option._tag === "None" ? missingExit : succeed8(option.value);

// ../../node_modules/effect/dist/SchemaIssue.js
var TypeId17 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId17) && u[TypeId17] === TypeId17;
}
function hasInput(issue) {
  return Object.hasOwn(issue, "input");
}

class IssueNodeImpl {
  [TypeId17] = TypeId17;
  constructor(input, options) {
    if (options?.reportInput === true && input !== missing) {
      this.input = input;
    }
  }
}
var Filter = class extends IssueNodeImpl {
  _tag = "Filter";
  filter;
  issue;
  constructor(filter, issue, input, options) {
    super(input, options);
    this.filter = filter;
    this.issue = issue;
  }
};
var Encoding = class extends IssueNodeImpl {
  _tag = "Encoding";
  ast;
  issue;
  constructor(ast, issue, input, options) {
    super(input, options);
    this.ast = ast;
    this.issue = issue;
  }
};
var Pointer = class extends IssueNodeImpl {
  _tag = "Pointer";
  path;
  issue;
  constructor(path, issue) {
    super();
    this.path = path;
    this.issue = issue;
  }
};
var MissingKey = class extends IssueNodeImpl {
  _tag = "MissingKey";
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
};
var UnexpectedKey = class extends IssueNodeImpl {
  _tag = "UnexpectedKey";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var Composite = class extends IssueNodeImpl {
  _tag = "Composite";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var InvalidType = class extends IssueNodeImpl {
  _tag = "InvalidType";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var InvalidValue = class extends IssueNodeImpl {
  _tag = "InvalidValue";
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var AnyOf = class extends IssueNodeImpl {
  _tag = "AnyOf";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var OneOf = class extends IssueNodeImpl {
  _tag = "OneOf";
  ast;
  successes;
  constructor(ast, successes, input, options) {
    super(input, options);
    this.ast = ast;
    this.successes = successes;
  }
};
function makeFilterIssue(entry, input, options) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue({
      message: entry
    }, input, options);
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue({
    message: entry.issue
  }, input, options) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(out, input, options) {
  if (out === undefined) {
    return;
  }
  if (typeof out === "boolean") {
    return out ? undefined : new InvalidValue(undefined, input, options);
  }
  return makeFilterIssue(out, input, options);
}
function normalizeFilterOutput(ast, out, input, options) {
  if (Array.isArray(out)) {
    if (!isReadonlyArrayNonEmpty(out)) {
      return;
    }
    return out.length === 1 ? makeFilterIssue(out[0], input, options) : new Composite(ast, map3(out, (entry) => makeFilterIssue(entry, input, options)), input, options);
  }
  return makeSingle(out, input, options);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== undefined)
    return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), issue);
    case "InvalidValue": {
      const expected = findExpected(issue);
      if (expected !== undefined)
        return getExpectedMessage(expected, issue);
      const input = formatInput(issue);
      return input === undefined ? "Expected a valid value" : `Invalid data ${input}`;
    }
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey": {
      const input = formatInput(issue);
      return input === undefined ? "Expected no excess property" : `Unexpected key with value ${input}`;
    }
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf": {
      const input = formatInput(issue);
      return input === undefined ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${input}`;
    }
  }
};
var defaultCheckHook = (issue) => findMessage(issue) ?? findMessage(issue.issue);
function formatInput(issue) {
  return hasInput(issue) ? format(issue.input) : undefined;
}
function findExpected(issue) {
  const expected = issue.annotations?.expected;
  return typeof expected === "string" ? expected : undefined;
}
function getExpectedMessage(expected, issue) {
  const input = formatInput(issue);
  return input === undefined ? `Expected ${expected}` : `Expected ${expected}, got ${input}`;
}
function getFilterMessage(issue, checkHook) {
  const message = checkHook(issue);
  if (message !== undefined || issue.issue._tag !== "InvalidValue")
    return message;
  const expected = findExpected(issue.issue);
  return expected === undefined ? getExpectedMessage(formatCheck(issue.filter), issue) : getExpectedMessage(expected, issue.issue);
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string")
    return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check) => formatCheck(check)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => formatIssue(issue, "");
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatIssue(issue, path, messageOverride) {
  let message;
  switch (issue._tag) {
    case "Filter":
      return formatIssue(issue.issue, path, messageOverride ?? getFilterMessage(issue, defaultCheckHook));
    case "Encoding":
      return formatIssue(issue.issue, path, messageOverride);
    case "Pointer":
      return formatIssue(issue.issue, path + formatPath(issue.path), messageOverride);
    case "Composite":
    case "AnyOf": {
      if (issue._tag === "Composite" || issue.issues.length > 0) {
        return issue.issues.map((issue) => formatIssue(issue, path, messageOverride)).join(`
`);
      }
      message = messageOverride ?? findMessage(issue) ?? getExpectedMessage(getExpected(issue.ast), issue);
      break;
    }
    default:
      message = messageOverride ?? defaultLeafHook(issue);
      break;
  }
  return path ? `${message}
  at ${path}` : message;
}
function findMessage(issue) {
  if (issue._tag === "Pointer" || issue._tag === "Composite")
    return;
  if (issue._tag === "Encoding")
    return findMessage(issue.issue);
  const annotations = issue._tag === "Filter" ? issue.filter.annotations : ("annotations" in issue) ? issue.annotations : issue.ast.annotations;
  const message = annotations?.[issue._tag === "MissingKey" ? "messageMissingKey" : issue._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
  if (typeof message === "string")
    return message;
}

// ../../node_modules/effect/dist/internal/schema/cause.js
function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === undefined) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

// ../../node_modules/effect/dist/SchemaGetter.js
var makeGetter = (fields) => Object.assign(Object.create(Prototype), fields);
var passthrough_ = /* @__PURE__ */ makeGetter({
  _tag: "Passthrough"
});
function passthrough2() {
  return passthrough_;
}
function transform(f) {
  return makeGetter({
    _tag: "Transform",
    transform: f
  });
}
function transformEffect(f) {
  return makeGetter({
    _tag: "TransformEffect",
    transform: f
  });
}
function String2() {
  return transform(globalThis.String);
}
function Number3() {
  return transform(globalThis.Number);
}
function parseJson(options) {
  return transformEffect((input, parseOptions) => try_3({
    try: () => JSON.parse(input, options?.reviver),
    catch: () => new InvalidValue({
      expected: "a valid JSON string"
    }, input, parseOptions)
  }));
}
function stringifyJson(options) {
  return transformEffect((input, parseOptions) => try_3({
    try: () => {
      const output = JSON.stringify(input, options?.replacer, options?.space);
      if (output === undefined) {
        throw new TypeError("Value cannot be represented as JSON");
      }
      return output;
    },
    catch: () => new InvalidValue({
      expected: "a JSON-serializable value"
    }, input, parseOptions)
  }));
}
function encodeBase64() {
  return transform(encode);
}
function decodeBase64() {
  return transformEffect((input, options) => mapErrorEager2(fromResult2(decode(input)), () => new InvalidValue({
    expected: "a valid Base64 string"
  }, input, options)));
}

// ../../node_modules/effect/dist/internal/schema/content.js
var ContentTypeId = /* @__PURE__ */ Symbol.for("~effect/Schema/content");
function setContent(operation, content) {
  Object.defineProperty(operation, ContentTypeId, {
    value: content
  });
  return operation;
}

// ../../node_modules/effect/dist/SchemaTransformation.js
var TypeId18 = "~effect/SchemaTransformation/Transformation";
var Transformation = class extends Class {
  [TypeId18] = TypeId18;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    super();
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
};
function isTransformation(u) {
  return hasProperty(u, TypeId18) && u[TypeId18] === TypeId18;
}
var makeTransformation = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformEffect2(options) {
  return new Transformation(transformEffect(options.decode), transformEffect(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough2(), /* @__PURE__ */ passthrough2());
function passthrough3() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ String2());
var isJsonError = (input) => isObject(input) && typeof input["message"] === "string";
var decodeJsonError = (input) => {
  const hasCause = Object.hasOwn(input, "cause");
  const err = hasCause ? new Error(input.message, {
    cause: decodeDefect(input.cause)
  }) : new Error(input.message);
  if (typeof input.name === "string" && input.name !== "Error")
    err.name = input.name;
  if (typeof input.stack === "string")
    err.stack = input.stack;
  return err;
};
var encodeUnknownAsJson = (input) => {
  try {
    const json = formatJson(input);
    return json === undefined ? format(input) : JSON.parse(json);
  } catch {
    return format(input);
  }
};
var encodeJsonError = (input, options, encodeDefect) => {
  const encoded = {
    name: input.name,
    message: typeof input.message === "string" ? input.message : ""
  };
  if (options?.includeStack && typeof input.stack === "string") {
    encoded.stack = input.stack;
  }
  if (!options?.excludeCause && input.cause !== undefined) {
    encoded.cause = encodeDefect(input.cause);
  }
  return encoded;
};
var makeEncodeDefect = (options) => {
  const seen = new WeakSet;
  const encode = (input) => {
    if (isError(input)) {
      if (seen.has(input)) {
        return "[Circular]";
      }
      seen.add(input);
      const encoded = encodeJsonError(input, options, encode);
      seen.delete(input);
      return encoded;
    }
    return encodeUnknownAsJson(input);
  };
  return encode;
};
var decodeDefect = (input) => isJsonError(input) ? decodeJsonError(input) : input;
var defectFromJson = (options) => transform2({
  decode: decodeDefect,
  encode: makeEncodeDefect(options)
});
var urlFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => URL.canParse(s) ? succeed6(new URL(s)) : fail6(new InvalidValue({
    expected: "a valid URL string"
  }, s, options)),
  encode: (url) => succeed6(url.href)
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase64(), /* @__PURE__ */ encodeBase64());
function fromJsonString(options) {
  return new Transformation(parseJson(options ?? {}), setContent(stringifyJson(options), {
    mediaType: "application/json",
    preserveSchema: options?.reviver === undefined && options?.replacer === undefined
  }));
}

// ../../node_modules/effect/dist/SchemaAST.js
function makeGuard(tag) {
  return (ast) => ast._tag === tag;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isSuspend = /* @__PURE__ */ makeGuard("Suspend");
var Link = class {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
};
var defaultParseOptions = {};
var Context = class {
  isOptional;
  isMutable;
  constructorDefault;
  annotations;
  constructor(isOptional, isMutable, constructorDefault = undefined, annotations = undefined) {
    this.isOptional = isOptional;
    this.isMutable = isMutable;
    this.constructorDefault = constructorDefault;
    this.annotations = annotations;
  }
};
var TypeId19 = "~effect/Schema";

class ASTNodeImpl {
  [TypeId19] = TypeId19;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = undefined, checks = undefined, encoding = undefined, context = undefined) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context;
  }
  toString() {
    return `<${this._tag}>`;
  }
}
var Declaration = class extends ASTNodeImpl {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  encodingRun;
  constructor(typeParameters, run, annotations, checks, encoding, context, encodingChecks, encodingRun) {
    super(annotations, checks, encoding, context);
    this.typeParameters = typeParameters;
    this.run = run;
    this.encodingChecks = encodingChecks;
    this.encodingRun = encodingRun;
  }
  getParser() {
    let run;
    return (input, options) => {
      if (input === missing)
        return missingExit;
      run ??= this.run(this.typeParameters);
      try {
        return run(input, this, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks, run, encodingRun) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks && run === this.run && encodingRun === this.encodingRun ? this : new Declaration(tps, run, this.annotations, checks, undefined, this.context, encodingChecks, encodingRun);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks, this.run, this.encodingRun);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
  }
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    return "<Declaration>";
  }
};
var Null = class extends ASTNodeImpl {
  _tag = "Null";
  getParser() {
    return fromConst(this, null);
  }
  getExpected() {
    return "null";
  }
};
var null_ = /* @__PURE__ */ new Null;
var Undefined = class extends ASTNodeImpl {
  _tag = "Undefined";
  getParser() {
    return fromConst(this, undefined);
  }
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  getExpected() {
    return "undefined";
  }
};
var undefinedToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => {
  return;
}), /* @__PURE__ */ transform(() => null)));
var undefined_3 = /* @__PURE__ */ new Undefined;
var Unknown = class extends ASTNodeImpl {
  _tag = "Unknown";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "unknown";
  }
};
var unknown = /* @__PURE__ */ new Unknown;
var Literal = class extends ASTNodeImpl {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context) {
    super(annotations, checks, encoding, context);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  getParser() {
    return fromConst(this, this.literal);
  }
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : undefined;
  }
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
};
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}
var String3 = class extends ASTNodeImpl {
  _tag = "String";
  getParser() {
    return fromRefinement(this, isString);
  }
  matchPart(s, options) {
    const checks = this.checks;
    return checks && !options.disableChecks && collectIssues(checks, s, undefined, this, options) ? undefined : s;
  }
  getExpected() {
    return "string";
  }
};
var string2 = /* @__PURE__ */ new String3;
var Number4 = class extends ASTNodeImpl {
  _tag = "Number";
  getParser() {
    return fromRefinement(this, isNumber);
  }
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    if (!regexp.test(s))
      return;
    const value = globalThis.Number(s);
    if (options.disableChecks || !this.checks)
      return value;
    return collectIssues(this.checks, value, undefined, this, options) ? undefined : value;
  }
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "effect/schema/isFinite") || hasCheck(this.checks, "effect/schema/isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  toCodecStringTree() {
    if (this.toCodecJson() === this) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  getExpected() {
    return "number";
  }
};
function hasCheck(checks, id) {
  return checks.some((check) => check.annotations?.representation?.id === id || check._tag === "FilterGroup" && hasCheck(check.checks, id));
}
var number2 = /* @__PURE__ */ new Number4;
var Arrays = class extends ASTNodeImpl {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    let hasOptional = false;
    for (let i = 0;i < elements.length; i++) {
      if (isOptional(elements[i])) {
        hasOptional = true;
      } else if (hasOptional) {
        throw new Error("A required element cannot follow an optional element. ts(1257)");
      }
    }
    if (hasOptional && rest.length > 1) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    for (let i = 1;i < rest.length; i++) {
      if (isOptional(rest[i])) {
        throw new Error("An optional element cannot follow a rest element. ts(1266)");
      }
    }
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    let elements;
    let rest;
    const elementLen = ast.elements.length;
    const tailLen = Math.max(0, ast.rest.length - 1);
    function getParser(tailThreshold, index) {
      if (index < elementLen) {
        return elements[index];
      } else if (index >= tailThreshold) {
        return rest[index - tailThreshold + 1];
      }
      return rest[0];
    }
    const finish = (state) => {
      const {
        input,
        len,
        options
      } = state;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen;i < len; i++) {
          const unexpected = new UnexpectedKey(ast, input[i], options);
          const issue = new Pointer([i], unexpected);
          if (options.errors === "all") {
            if (state.issues)
              state.issues.push(issue);
            else
              state.issues = [issue];
          } else {
            return fail6(new Composite(ast, [issue], input, options));
          }
        }
      }
      if (state.issues) {
        return fail6(new Composite(ast, state.issues, input, options));
      }
      return succeed8(state.output);
    };
    const parse = (input, options) => {
      const len = input.length;
      const state = {
        ast,
        getParser,
        input,
        len,
        tailThreshold: Math.max(elementLen, len - tailLen),
        output: [],
        issues: undefined,
        options
      };
      const end = ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen);
      const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
      const eff = concurrency === 1 ? parseArray(state, input, 0, end) : parseArrayConcurrent(state, input, {
        concurrency,
        end
      });
      if (!eff)
        return finish(state);
      if (effectIsExit(eff))
        return flatMapEager2(eff, () => finish(state));
      let first = true;
      return suspend2(() => {
        if (!first)
          return parse(input, options);
        first = false;
        return flatMap3(eff, () => finish(state));
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      try {
        if (!Array.isArray(input)) {
          return fail6(new InvalidType(ast, input, options));
        }
        if (!elements) {
          elements = ast.elements.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
          rest = ast.rest.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
        }
        return parse(input, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    return "array";
  }
};
function stepArray(s, item, exit, i) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, i, exit);
  }
  const value = isSameExit(exit) ? item : exit[args];
  if (value !== missing) {
    s.output[i] = value;
  } else {
    const p = s.getParser(s.tailThreshold, i);
    if (isOptional(p.ast))
      return;
    const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      return fail5(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parseArrayOptions = {
  onItem(s, item, i) {
    const value = i < s.len ? item : missing;
    return s.getParser(s.tailThreshold, i).parser(value, s.options);
  },
  step: stepArray
};
var parseArray = /* @__PURE__ */ iterateEager()(parseArrayOptions);
var parseArrayConcurrent = /* @__PURE__ */ iterateConcurrent()(parseArrayOptions);
var wrapPropertyKeyIssue = (s, ast, key, exit) => {
  if (exit.cause.reasons.length === 0) {
    return exit;
  }
  const issue = getSchemaIssue(exit.cause);
  if (issue === undefined) {
    return failCause2(map5(exit.cause, (issue) => new Composite(ast, [new Pointer([key], issue)], s.input, s.options)));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues)
      s.issues.push(pointer);
    else
      s.issues = [pointer];
  } else {
    return fail5(new Composite(ast, [pointer], s.input, s.options));
  }
};
var FINITE_PATTERN = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter) {
    switch (parameter._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchPart(k, options) !== undefined);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchKey(k, options) !== undefined);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => Object.prototype.propertyIsEnumerable.call(input, k) && parameter.matchKey(k, options) !== undefined);
      case "Union":
        return [...new Set(parameter.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}
var PropertySignature = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
};
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameterEncodedSide(ast) {
  const encoded = getLastEncoding(ast);
  switch (encoded._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return encoded.types.every(isIndexSignatureParameterEncodedSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterEncodedSide(ast);
}
var IndexSignature = class {
  parameter;
  type;
  constructor(parameter, type) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    if (isOptional(type) || type.encoding !== undefined && isOptional(toEncoded(type))) {
      throw new Error("Cannot use `Schema.optionalKey` or `Schema.optional` with index signatures. Index signatures already allow keys to be absent; use `Schema.UndefinedOr` to allow `undefined` values.");
    }
  }
};
var Objects = class extends ASTNodeImpl {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    const hasProperties = ast.propertySignatures.length;
    const indexCount = ast.indexSignatures.length;
    if (!hasProperties && !indexCount) {
      return fromRefinement(ast, isNotNullish);
    }
    let properties;
    let indexes;
    const compileMembers = () => {
      if (!properties) {
        properties = ast.propertySignatures.map((ps) => ({
          parser: compileField(ps.type),
          name: ps.name,
          type: ps.type,
          ownOnly: requiresOwnProperty(ps.name)
        }));
        indexes = indexCount ? ast.indexSignatures.map((is) => ({
          is,
          parserKey: compile(parameterFromPropertyKey(is.parameter)),
          parserValue: compileField(is.type)
        })) : undefined;
      }
      return properties;
    };
    const makeFallback = () => {
      const expectedKeys = new Set(ast.propertySignatures.map((ps) => typeof ps.name === "number" ? globalThis.String(ps.name) : ps.name));
      const finishIndex = (s, key, k2, inputValue, exitValue) => {
        if (exitValue._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitValue) ?? void_3;
        }
        const value = isSameExit(exitValue) ? inputValue : exitValue[args];
        if (k2 !== missing && value !== missing) {
          if (hasProperties && (expectedKeys.has(key) || expectedKeys.has(typeof k2 === "number" ? globalThis.String(k2) : k2)))
            return void_3;
          assignProperty(s.out, k2, value);
        }
        return void_3;
      };
      const parseIndex = (s, key, index, exitKey) => {
        if (!exitKey) {
          const eff = index.parserKey(key, s.options);
          if (!effectIsExit(eff)) {
            return flatMap3(exit2(eff), (exit) => parseIndex(s, key, index, exit));
          }
          exitKey = eff;
        }
        if (exitKey._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitKey) ?? void_3;
        }
        const k2 = isSameExit(exitKey) ? key : exitKey[args];
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, k2, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, k2, inputValue, exit));
      };
      const parseStringIndex = (s, key, index) => {
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, key, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, key, inputValue, exit));
      };
      const parseIndexes = indexCount ? iterateConcurrent()({
        onItem: (s, [key, index]) => index.is.parameter === string2 ? parseStringIndex(s, key, index) : parseIndex(s, key, index),
        step: (_s, _item, exit) => exit._tag === "Failure" ? exit : undefined
      }) : undefined;
      return fnUntracedEager2(function* (input, options) {
        if (input === missing) {
          return missing;
        }
        if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
          return yield* fail6(new InvalidType(ast, input, options));
        }
        compileMembers();
        const record = input;
        const out = {};
        const state = {
          ast,
          input: record,
          out,
          issues: undefined,
          options
        };
        const errorsAllOption = options.errors === "all";
        const onExcessPropertyError = options.onExcessProperty === "error";
        const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
        const indexKeys = indexCount && onExcessPropertyError ? ast.indexSignatures.map((index) => getIndexSignatureKeys(record, index.parameter, options)) : undefined;
        if (onExcessPropertyError) {
          const coveredKeys = indexKeys ? new Set(expectedKeys) : expectedKeys;
          if (indexKeys) {
            for (const keys of indexKeys) {
              for (const key of keys)
                coveredKeys.add(key);
            }
          }
          const inputKeys = Reflect.ownKeys(record);
          for (let i = 0;i < inputKeys.length; i++) {
            const key = inputKeys[i];
            if (!coveredKeys.has(key) && Object.prototype.propertyIsEnumerable.call(record, key)) {
              const unexpected = new UnexpectedKey(ast, record[key], options);
              const issue = new Pointer([key], unexpected);
              if (errorsAllOption) {
                if (state.issues) {
                  state.issues.push(issue);
                } else {
                  state.issues = [issue];
                }
                continue;
              } else {
                return yield* fail6(new Composite(ast, [issue], input, options));
              }
            }
          }
        }
        if (hasProperties) {
          const eff = concurrency === 1 ? parseProperties(state, properties) : parsePropertiesConcurrent(state, properties, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (indexCount && concurrency === 1) {
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const parse = index.is.parameter === string2 ? parseStringIndex : parseIndex;
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              const eff = parse(state, keys[j], index);
              if (!effectIsExit(eff))
                yield* eff;
              else if (eff._tag === "Failure")
                return yield* eff;
            }
          }
        } else if (parseIndexes) {
          const keyPairs = empty2();
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              keyPairs.push([keys[j], index]);
            }
          }
          const eff = parseIndexes(state, keyPairs, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (state.issues) {
          return yield* fail6(new Composite(ast, state.issues, input, options));
        }
        return out;
      });
    };
    if (indexCount)
      return makeFallback();
    let fallback;
    const resume = (snapshot, index, pending) => {
      const property = properties[index];
      return flatMap3(exit2(pending), (exit) => {
        const state = {
          ...snapshot,
          out: {
            ...snapshot.out
          }
        };
        const terminal = stepProperty(state, property, exit);
        if (terminal)
          return terminal;
        const done = () => succeed8(state.out);
        const eff = parseProperties(state, properties.slice(index + 1));
        return eff ? flatMapEager2(eff, done) : done();
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      if (options.errors === "all" || options.onExcessProperty !== undefined || options.concurrency !== undefined && resolveConcurrency(options.concurrency) !== 1) {
        return (fallback ??= makeFallback())(input, options);
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return fail6(new InvalidType(ast, input, options));
      }
      const props = compileMembers();
      const record = input;
      const out = {};
      const state = {
        ast,
        input: record,
        out,
        issues: undefined,
        options
      };
      try {
        for (let index = 0;index < props.length; index++) {
          const property = props[index];
          const name = property.name;
          const hasKey = property.ownOnly ? Object.hasOwn(record, name) : (name in record);
          const value = hasKey ? record[name] : missing;
          const exit = property.parser(value, options);
          if (!effectIsExit(exit)) {
            return resume(state, index, exit);
          }
          if (isSameExit(exit)) {
            if (hasKey)
              assignProperty(out, name, value);
            continue;
          }
          const terminal = stepProperty(state, property, exit);
          if (terminal)
            return terminal;
        }
      } catch (error) {
        return die3(error);
      }
      return succeed8(out);
    };
  }
  _rebuild(recur, recurParameter, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is) => {
      const p = recurParameter(is.parameter);
      const t = recur(is.type);
      return p === is.parameter && t === is.type ? is : new IndexSignature(p, t);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, recur, this.encodingChecks, this.checks);
  }
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, this.checks, this.encodingChecks);
  }
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0)
      return "object | array";
    return "object";
  }
};
function stepProperty(s, p, exit) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, p.name, exit);
  }
  if (isSameExit(exit))
    return;
  const value = exit[args];
  if (value !== missing) {
    assignProperty(s.out, p.name, value);
    return;
  }
  delete s.out[p.name];
  if (!isOptional(p.type)) {
    const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
      return;
    } else {
      return fail5(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parsePropertiesOptions = {
  onItem(s, p) {
    if (!(p.ownOnly ? Object.hasOwn(s.input, p.name) : (p.name in s.input))) {
      return p.parser(missing, s.options);
    }
    const value = s.input[p.name];
    assignProperty(s.out, p.name, value);
    return p.parser(value, s.options);
  },
  step: stepProperty
};
var parseProperties = /* @__PURE__ */ iterateEager()(parsePropertiesOptions);
var parsePropertiesConcurrent = /* @__PURE__ */ iterateConcurrent()(parsePropertiesOptions);
function combineChecks(a, b) {
  if (!a)
    return b;
  if (!b)
    return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function union(members, options, checks) {
  return new Union(members.map(getAST), options, undefined, checks);
}
var toCandidate = /* @__PURE__ */ memoizeIdempotent((ast) => {
  while (true) {
    if (isSuspend(ast))
      return unknown;
    const encoding = ast.encoding;
    if (!encoding) {
      return ast.recur?.(toCandidate, identity) ?? ast;
    }
    if (encoding.some((link) => link.transformation._tag === "Middleware" && link.transformation.decode !== identity))
      return unknown;
    ast = encoding[encoding.length - 1].to;
  }
});
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.[SENTINELS_ANNOTATION_KEY];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        if (!isOptional(e)) {
          if (isLiteral(e)) {
            return [{
              key: i,
              literal: e.literal
            }];
          }
          if (isUniqueSymbol(e)) {
            return [{
              key: i,
              literal: e.symbol
            }];
          }
        }
        return [];
      });
    case "Union": {
      if (ast.types.length === 0)
        return [];
      const members = ast.types.map((type) => collectSentinels(toCandidate(type)));
      return members[0].filter((s) => members.every((sentinels) => sentinels.some((o) => o.key === s.key && o.literal === s.literal)));
    }
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap;
var emptyCandidates = /* @__PURE__ */ Object.freeze([]);
var getRuntimeType = (input) => input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
var objectPrototypeKeys = /* @__PURE__ */ new Set(Reflect.ownKeys(Object.prototype)).add("__proto__");
var requiresOwnProperty = (key) => objectPrototypeKeys.has(typeof key === "number" ? globalThis.String(key) : key);
var hasPropertySignature = (input, key) => Object.hasOwn(input, key) || (key in input) && !requiresOwnProperty(key);
function getCandidateIndex(types) {
  let index = candidateIndexCache.get(types);
  if (index)
    return index;
  let bySentinel;
  let sentinelCandidateCount = 0;
  let otherwise;
  let literalCandidates;
  let onlyLiterals = true;
  const literalOf = [];
  for (let i = 0;i < types.length; i++) {
    const a = types[i];
    const encoded = toCandidate(a);
    if (isNever2(encoded))
      continue;
    if (isLiteral(encoded) || isUniqueSymbol(encoded)) {
      literalCandidates ??= new Map;
      const literal = isLiteral(encoded) ? encoded.literal : encoded.symbol;
      literalOf[i] = literal;
      let arr = literalCandidates.get(literal);
      if (!arr)
        literalCandidates.set(literal, arr = []);
      arr.push(i);
    } else {
      onlyLiterals = false;
    }
    const sentinels = collectSentinels(encoded);
    if (sentinels.length) {
      bySentinel ??= new Map;
      sentinelCandidateCount++;
      for (const {
        key,
        literal
      } of sentinels) {
        let entry = bySentinel.get(key);
        if (!entry)
          bySentinel.set(key, entry = [new Map, new Set]);
        entry[1].add(i);
        let indexes = entry[0].get(literal);
        if (!indexes)
          entry[0].set(literal, indexes = new Set);
        indexes.add(i);
      }
    } else {
      otherwise ??= {};
      const candidateTypes = getCandidateTypes(encoded);
      for (const t of candidateTypes)
        (otherwise[t] ??= []).push(i);
    }
  }
  const fallbacks = {};
  const getFallback = (type) => fallbacks[type] ??= Object.freeze(otherwise?.[type] ?? emptyCandidates);
  if (onlyLiterals && literalCandidates) {
    literalCandidates.forEach(Object.freeze);
    index = (input) => literalCandidates.get(input) ?? emptyCandidates;
  } else if (bySentinel?.size === 1 && !otherwise) {
    const [key, [byValue]] = bySentinel.entries().next().value;
    const candidates = new Map;
    for (const [literal, indexes] of byValue) {
      candidates.set(literal, Object.freeze(Array.from(indexes)));
    }
    const all = Object.freeze(types.map((_, i) => i));
    index = (input, isConstructor) => {
      if (isObjectKeyword(input)) {
        const value = hasPropertySignature(input, key) ? input[key] : undefined;
        if (value !== undefined)
          return candidates.get(value) ?? emptyCandidates;
        if (isConstructor)
          return all;
      }
      return emptyCandidates;
    };
  } else if (bySentinel) {
    let commonSentinel;
    for (const entry of bySentinel) {
      if ((!commonSentinel || entry[1][0].size > commonSentinel[1][0].size) && entry[1][1].size === sentinelCandidateCount) {
        commonSentinel = entry;
      }
    }
    index = (input, isConstructor) => {
      const runtimeType = getRuntimeType(input);
      if (!isObjectKeyword(input))
        return getFallback(runtimeType);
      const selected = new Set(otherwise?.[runtimeType]);
      let directKey;
      if (commonSentinel) {
        const [key, [byValue]] = commonSentinel;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          if (!match)
            return getFallback(runtimeType);
          for (const i of match)
            selected.add(i);
          directKey = key;
        }
      }
      if (directKey === undefined) {
        for (const [key, [byValue, all]] of bySentinel) {
          const hasKey = hasPropertySignature(input, key);
          const value = hasKey ? input[key] : undefined;
          if (hasKey && (!isConstructor || value !== undefined)) {
            const match = byValue.get(value);
            if (match) {
              for (const i of match)
                selected.add(i);
            }
          } else if (isConstructor) {
            for (const i of all)
              selected.add(i);
          }
        }
      }
      for (const [key, [byValue, all]] of bySentinel) {
        if (key === directKey)
          continue;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          for (const i of selected) {
            if (all.has(i) && !match?.has(i))
              selected.delete(i);
          }
        }
      }
      return Array.from(selected).sort((a, b) => a - b);
    };
  } else {
    index = (input) => {
      const fallback = getFallback(getRuntimeType(input));
      return literalCandidates ? fallback.filter((i) => literalOf[i] === undefined || literalOf[i] === input) : fallback;
    };
  }
  candidateIndexCache.set(types, index);
  return index;
}
var Union = class extends ASTNodeImpl {
  _tag = "Union";
  types;
  options;
  encodingChecks;
  constructor(types, options, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.types = types;
    this.options = options;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField) {
    const ast = this;
    const isConstructor = compileField !== undefined;
    const parsers = [];
    const parser = (i) => parsers[i] ??= compile(ast.types[i]);
    let index;
    return (input, options) => {
      if (input === missing) {
        return missingExit;
      }
      const candidates = (index ??= getCandidateIndex(ast.types))(input, isConstructor);
      if (candidates.length === 0) {
        return fail6(new AnyOf(ast, [], input, options));
      }
      if (candidates.length === 1) {
        const result = parser(candidates[0])(input, options);
        if (result._tag === "Success")
          return result;
        return effectIsExit(result) ? failSingleUnionCandidate(ast, result.cause, input, options) : catchSingleUnionCandidate(ast, result, input, options);
      }
      return parseUnionCandidates(ast, parser, candidates, input, options);
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.options, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== undefined)
        return out;
    }
    return;
  }
  getExpected(getExpected) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    if (this.types.length === 0)
      return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
};
function failSingleUnionCandidate(ast, cause, input, options) {
  const issue = getSchemaIssue(cause);
  if (!issue)
    return failCause2(cause);
  return fail5(new AnyOf(ast, [issue], input, options));
}
function catchSingleUnionCandidate(ast, result, input, options) {
  return catchCause2(result, (cause) => failSingleUnionCandidate(ast, cause, input, options));
}
function parseUnionCandidates(ast, parser, candidates, input, options) {
  const state = {
    ast,
    parser,
    input,
    out: undefined,
    successes: ast.options?.mode === "oneOf" ? [] : undefined,
    issues: undefined,
    options
  };
  const eff = parseUnion(state, candidates);
  if (!eff) {
    if (state.out)
      return state.out;
    return fail6(new AnyOf(ast, state.issues ?? [], input, options));
  }
  if (effectIsExit(eff))
    return resumeUnion(eff, state);
  let first = true;
  return suspend2(() => {
    if (!first)
      return parseUnionCandidates(ast, parser, candidates, input, options);
    first = false;
    return resumeUnion(eff, state);
  });
}
function resumeUnion(eff, state) {
  return flatMapEager2(eff, (_) => {
    if (state.out)
      return isSameExit(state.out) ? succeed6(state.input) : state.out;
    return fail6(new AnyOf(state.ast, state.issues ?? [], state.input, state.options));
  });
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, i) {
    return s.parser(i)(s.input, s.options);
  },
  step(s, i, exit) {
    if (exit._tag === "Failure") {
      const issue = getSchemaIssue(exit.cause);
      if (issue === undefined) {
        return exit;
      }
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      if (s.out && s.successes) {
        s.successes.push(s.ast.types[i]);
        return fail5(new OneOf(s.ast, s.successes, s.input, s.options));
      }
      s.out = exit;
      if (s.successes) {
        s.successes.push(s.ast.types[i]);
      } else {
        return void_3;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")]);
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
  return isOptional ? "?" : "";
}
var Filter2 = class extends Class {
  _tag = "Filter";
  run;
  annotations;
  aborted;
  constructor(run, annotations = undefined, aborted = false) {
    super();
    this.run = run;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
var FilterGroup = class extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = undefined) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
function makeFilter(filter, annotations, aborted = false) {
  return new Filter2((input, ast, options) => normalizeFilterOutput(ast, filter(input, ast, options), input, options), annotations, aborted);
}
function isFinite2(annotations) {
  return makeFilter((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    representation: {
      id: "effect/schema/isFinite",
      payload: null
    },
    toJsonSchema: () => ({
      type: "number"
    }),
    toCode: () => ({
      runtime: "Schema.isFinite()"
    }),
    arbitraryConstraint: {
      number: "finite"
    },
    ...annotations
  });
}
var finite = /* @__PURE__ */ appendChecks(number2, [/* @__PURE__ */ isFinite2()]);
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finite, nonFiniteLiterals]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function isPattern(regExp, annotations) {
  const copy = new globalThis.RegExp(regExp);
  const payload = {
    source: copy.source,
    flags: copy.flags
  };
  return makeFilter((s) => {
    copy.lastIndex = 0;
    return copy.test(s);
  }, {
    expected: `a string matching the RegExp ${payload.source}`,
    representation: {
      id: "effect/schema/isPattern",
      payload
    },
    toJsonSchema: () => [{}, true],
    arbitraryConstraint: {
      patterns: [payload]
    },
    ...annotations
  });
}
var bodyOwners = /* @__PURE__ */ new WeakMap;
function copy(ast, changes) {
  const out = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, changes);
  if (Reflect.ownKeys(changes).every((key) => key === "context" || key === "encoding")) {
    bodyOwners.set(out, getContextOwner(ast));
  }
  return out;
}
function getContextOwner(ast) {
  const existing = bodyOwners.get(ast);
  if (existing !== undefined)
    return existing;
  if (ast.encoding === undefined)
    return ast;
  const owner = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, {
    encoding: undefined
  });
  bodyOwners.set(ast, owner);
  return owner;
}
function replaceEncoding(ast, encoding) {
  return ast.encoding === encoding ? ast : copy(ast, {
    encoding
  });
}
function replaceContext(ast, context) {
  if (ast.context === context) {
    return ast;
  }
  const owner = getContextOwner(ast);
  if (owner.context === context && owner.encoding === ast.encoding) {
    return owner;
  }
  return copy(ast, {
    context
  });
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return copy(ast, {
    annotations: {
      ...ast.annotations,
      ...annotations
    }
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return copy(ast, {
    checks
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function mapLink(link, f) {
  const to = f(link.to);
  return to === link.to ? link : new Link(to, link.transformation);
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const out = mapLink(last, f);
  return out === last ? encoding : append(encoding.slice(0, encoding.length - 1), out);
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function replaceContextLastLink(ast, context) {
  return applyToLastLink((ast) => replaceContext(ast, context))(ast);
}
function applyToSelfOrLastLinkEncodingIdempotent(f, options) {
  function out(ast) {
    if (ast.encoding) {
      const last = ast.encoding[ast.encoding.length - 1];
      return options?.stopAt?.(last) ? ast : replaceEncoding(ast, updateLastLink(ast.encoding, out));
    }
    return f(ast);
  }
  return memoizeIdempotent(out);
}
function appendTransformation(from, transformation, to) {
  const link = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function mapOrSame(as, f) {
  let out;
  for (let i = 0;i < as.length; i++) {
    const a = as[i];
    const fa = f(a);
    if (out) {
      out[i] = fa;
    } else if (fa !== a) {
      out = new Array(as.length);
      for (let j = 0;j < i; j++) {
        out[j] = as[j];
      }
      out[i] = fa;
    }
  }
  return out ?? as;
}
function annotateKey(ast, annotations) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.constructorDefault, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, undefined, annotations);
  return replaceContext(ast, context);
}
var optionalKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context));
});
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
var optional = /* @__PURE__ */ memoize((ast) => optionalKey(new Union([ast, undefined_3])));
function withConstructorDefault(ast, defaultValue) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, defaultValue, ast.context.annotations) : new Context(false, false, defaultValue);
  return replaceContext(ast, context);
}
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isStructuralCheck(check) {
  return check.annotations?.[STRUCTURAL_ANNOTATION_KEY] === true || check._tag === "FilterGroup" && check.checks.every(isStructuralCheck);
}
function extractStructuralChecks(checks) {
  function extract(check) {
    if (isStructuralCheck(check))
      return [check];
    return check._tag === "FilterGroup" ? check.checks.flatMap(extract) : [];
  }
  const out = checks.flatMap(extract);
  return isArrayNonEmpty2(out) ? out : undefined;
}
function canPreserveEncodingChecks(ast) {
  let preserve = true;
  function visit(child) {
    preserve = preserve && !child.encoding && !isSuspend(child);
    if (preserve && "recur" in child)
      child.recur(visit);
    return child;
  }
  if ("recur" in ast)
    ast.recur(visit);
  return preserve;
}
var toType = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const type = toType(owner);
    return type === owner && ast.encoding === undefined ? ast : replaceContext(type, ast.context);
  }
  const type = "recur" in ast ? ast.recur(toType) : ast;
  if ("encodingChecks" in type && type.encodingChecks) {
    const checks = canPreserveEncodingChecks(ast) ? type.encodingChecks : isArrays(type) || isObjects(type) || isDeclaration(type) && type.typeParameters.length > 0 ? extractStructuralChecks(type.encodingChecks) : undefined;
    return copy(type, {
      encodingChecks: undefined,
      checks: combineChecks(checks, type.checks)
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoizeIdempotent((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, undefined)), links[0].transformation.flip())];
  for (let i = 1;i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const flipped = flip2(owner);
    return flipped === owner ? ast : replaceContext(flipped, ast.context);
  }
  return "flip" in ast ? ast.flip(flip2) : ("recur" in ast) ? ast.recur(flip2) : ast;
});
function fromConst(ast, value) {
  const succeed = value === 0 ? sameExit : succeed8(value);
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (input === value)
      return succeed;
    return fail6(new InvalidType(ast, input, options));
  };
}
function fromRefinement(ast, refinement) {
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (refinement(input))
      return sameExit;
    return fail6(new InvalidType(ast, input, options));
  };
}
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var parameterFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Symbol":
    case "UniqueSymbol":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromString);
  }
});
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    representation: {
      id: "effect/schema/isStringFinite",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: isStringFiniteRegExp.source
    }),
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals]), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
var REGEXP_PATTERN = "Symbol\\(([\\s\\S]*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
function collectIssues(checks, value, issues, ast, options) {
  for (let i = 0;i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      issues = collectIssues(check.checks, value, issues, ast, options);
      if (issues && (options.errors !== "all" || issues[issues.length - 1].filter.aborted)) {
        return issues;
      }
    } else {
      const issue = check.run(value, ast, options);
      if (issue) {
        const filter = new Filter(check, issue, value, options);
        if (issues)
          issues.push(filter);
        else
          issues = [filter];
        if (options.errors !== "all" || check.aborted) {
          return issues;
        }
      }
    }
  }
  return issues;
}
function getConstructorDescriptor(ast) {
  if (!isDeclaration(ast))
    return;
  const getDescriptor = ast.annotations?.[CONSTRUCTOR_ANNOTATION_KEY];
  return isFunction(getDescriptor) ? getDescriptor(ast.typeParameters) : undefined;
}
function isJsonLeaf(u) {
  return u === null || typeof u === "string" || typeof u === "boolean" || typeof u === "number" && globalThis.Number.isFinite(u);
}
function isStringTreeLeaf(u) {
  return u === undefined || typeof u === "string";
}
function isTree(u, isLeaf) {
  const cache = new WeakMap;
  const stack = [];
  outer:
    while (true) {
      if (typeof u !== "object" || u === null) {
        if (!isLeaf(u)) {
          return false;
        }
      } else {
        const value = u;
        const cached = cache.get(value);
        if (cached === false) {
          return false;
        }
        if (cached === undefined) {
          const isArray = Array.isArray(value);
          if (!isArray) {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
              return false;
            }
          }
          cache.set(value, false);
          stack.push({
            value,
            keys: isArray ? value.length : Object.keys(value),
            index: 0
          });
        }
      }
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const keys = frame.keys;
        if (typeof keys === "number") {
          if (frame.index < keys) {
            u = frame.value[frame.index++];
            continue outer;
          }
        } else if (frame.index < keys.length) {
          u = frame.value[keys[frame.index++]];
          continue outer;
        }
        cache.set(frame.value, true);
        stack.pop();
      }
      return true;
    }
}
function isJson(u) {
  return isTree(u, isJsonLeaf);
}
var Json = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isJson(input) ? sameExit : fail6(new InvalidType(ast, input, options)), {
  representation: {
    id: "effect/schema/Json",
    payload: null
  },
  expected: "JSON value",
  toCodecJson: () => {
    return;
  },
  toCodecStringTree: () => unknownToStringTree
});
var unknownToJson = /* @__PURE__ */ new Link(Json, /* @__PURE__ */ passthrough3());
var objectKeywordToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([/* @__PURE__ */ new Arrays(false, [], [Json]), /* @__PURE__ */ new Objects([], [/* @__PURE__ */ new IndexSignature(string2, Json)])]), /* @__PURE__ */ passthrough3());
function isStringTree(u) {
  return isTree(u, isStringTreeLeaf);
}
var StringTree = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isStringTree(input) ? sameExit : fail6(new InvalidType(ast, input, options)), {
  expected: "StringTree",
  toCodecStringTree: () => {
    return;
  }
});
var unknownToStringTree = /* @__PURE__ */ new Link(StringTree, /* @__PURE__ */ passthrough3());

// ../../node_modules/effect/dist/internal/schema/interpreter.js
var flatMapTransformation = (result, current, f) => isSameExit(result) ? f(current) : flatMapEager2(result, f);
function compileTransformation(transformation) {
  const apply = compileTransformationUnsafe(transformation);
  return (result, current, options) => {
    try {
      return apply(result, current, options);
    } catch (error) {
      return die3(error);
    }
  };
}
function compileTransformationUnsafe(transformation) {
  if (transformation._tag === "Middleware") {
    return (result, current, options) => {
      const transformed = isSameExit(result) ? transformation.decode(succeed8(toOption(current)), options) : transformation.decode(mapEager2(result, toOption), options);
      return fromOptionalEffect(transformed);
    };
  }
  const getter = transformation.decode;
  switch (getter._tag) {
    case "Passthrough":
      return (result, current) => isSameExit(result) ? succeed8(current) : result;
    case "Transform": {
      const transform = (value) => value === missing ? missingExit : succeed8(getter.transform(value));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformOptional": {
      const transform = (value) => fromOptionExit(getter.transform(toOption(value)));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => value === missing ? missingExit : getter.transform(value, options));
    case "TransformOptionalEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => fromOptionalEffect(getter.transform(toOption(value), options)));
  }
}
var fromOptionalEffect = (effect) => flatMapEager2(effect, fromOptionExit);
var wrapEncoding = (ast, input, options, effect) => catchCause2(effect, (cause) => failCauseSync2(() => map5(cause, (issue) => new Encoding(ast, issue, input, options))));
function makeConstructorParser(descriptor, compile) {
  const transform = compileTransformation(descriptor.link.transformation);
  let sourceParser;
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (descriptor.isConstructed(input))
      return sameExit;
    const result = (sourceParser ??= compile(descriptor.link.to))(input, options);
    return transform(result, input, options);
  };
}
function withDefault(ast, parser) {
  const defaultValue = ast.context.constructorDefault;
  return (input, options) => {
    if (input !== missing && input !== undefined)
      return parser(input, options);
    const result = defaultValue;
    if (effectIsExit(result) && result._tag === "Success") {
      const local = parser(result[args], options);
      return isSameExit(local) ? result : local;
    }
    return flatMapEager2(wrapEncoding(ast, input, options, result), (value) => {
      const local = parser(value, options);
      return isSameExit(local) ? succeed8(value) : local;
    });
  };
}
function compileField(ast, compile) {
  const parser = compile(ast);
  return ast.context?.constructorDefault === undefined ? parser : withDefault(ast, parser);
}
function compile(ast, compile, compileField, base, specialize) {
  if (ast._tag === "Declaration") {
    for (const parameter of ast.typeParameters)
      compile(parameter);
  }
  const descriptor = compileField ? getConstructorDescriptor(ast) : undefined;
  const parser = descriptor ? makeConstructorParser(descriptor, compile) : base ?? ast.getParser(compile, compileField);
  const checks = ast.checks;
  const links = ast.encoding;
  const transformations = links?.map((link) => compileTransformation(link.transformation));
  const encodingChecks = ast.encodingChecks;
  if (!links && !checks && !encodingChecks) {
    return parser;
  }
  let encodingParsers;
  const parseChecks = (input, options) => {
    let result = parser(input, options);
    try {
      if (encodingChecks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const output = isSameExit(result) ? input : result[args];
            if (input !== missing && output !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                result = fail6(new Composite(ast, issues, input, options));
              }
            }
          }
        } else {
          result = flatMap3(result, (value) => {
            if (input !== missing && value !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                return fail6(new Composite(ast, issues, input, options));
              }
            }
            return succeed6(value);
          });
        }
      }
      if (checks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const value = isSameExit(result) ? input : result[args];
            if (value === missing)
              return result;
            const issues = collectIssues(checks, value, undefined, ast, options);
            if (issues) {
              result = fail6(new Composite(ast, issues, value, options));
            }
          }
        } else {
          result = flatMap3(result, (value) => {
            if (value !== missing) {
              const issues = collectIssues(checks, value, undefined, ast, options);
              if (issues) {
                return fail6(new Composite(ast, issues, value, options));
              }
            }
            return succeed6(value);
          });
        }
      }
      return result;
    } catch (error) {
      return die3(error);
    }
  };
  const parseLocal = specialize === undefined ? parseChecks : specialize(parseChecks);
  if (!links) {
    return parseLocal;
  }
  return (input, options) => {
    const parsers = encodingParsers ??= links.map((link) => compile(link.to));
    let current = input;
    let result = parsers[parsers.length - 1](input, options);
    for (let i = links.length - 1;i >= 0; i--) {
      result = transformations[i](result, current, options);
      if (i !== 0) {
        const next = parsers[i - 1];
        if (result._tag === "Success") {
          current = result[args];
          result = next(current, options);
        } else {
          result = flatMapEager2(result, (value) => {
            const nextResult = next(value, options);
            return isSameExit(nextResult) ? succeed8(value) : nextResult;
          });
        }
      }
    }
    if (result._tag === "Success") {
      const value = result[args];
      const local = parseLocal(value, options);
      return isSameExit(local) ? result : local;
    }
    result = wrapEncoding(ast, input, options, result);
    return flatMapEager2(result, (value) => {
      const local = parseLocal(value, options);
      return isSameExit(local) ? succeed8(value) : local;
    });
  };
}

// ../../node_modules/effect/dist/internal/schema/compilerRegistry.js
var invalid2 = /* @__PURE__ */ Symbol();
var cache = /* @__PURE__ */ new WeakMap;
var compiler;
var compilerAdaptersEnabled = false;
var decodeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "parser") : resolve2(ast).parser;
var makeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "makeEffect") : resolve2(ast).makeEffect;
var makeField = (ast) => compileField(ast, makeChild);

class InterpretedEntry {
  ast;
  constructor(ast) {
    this.ast = ast;
  }
  get decodeEffect() {
    return this.cachedDecodeEffect ??= compile(this.ast, decodeChild);
  }
  get parser() {
    return this.decodeEffect;
  }
  get makeEffect() {
    return this.cachedMakeEffect ??= compile(this.ast, makeChild, makeField);
  }
}

class CompilerEntry extends InterpretedEntry {
  compiled;
  resolve;
  constructor(ast, compiled, resolve) {
    super(ast);
    this.compiled = compiled;
    this.resolve = resolve;
  }
  save(key, value) {
    Object.defineProperty(this, key, {
      value
    });
    return value;
  }
  operation(key) {
    const compiled = this.compiled;
    return typeof compiled === "function" ? compiled(this.ast, this.resolve, key) : compiled?.[key];
  }
  get is() {
    return this.save("is", this.operation("is"));
  }
  get decode() {
    return this.save("decode", this.operation("decode"));
  }
  get make() {
    return this.save("make", this.operation("make"));
  }
  get compiledMakeEffect() {
    return this.save("compiledMakeEffect", this.operation("makeEffect"));
  }
  get decodeEffect() {
    return this.save("decodeEffect", this.operation("decodeEffect") ?? compile(this.ast, (ast) => lazyParser(this.resolve, ast, "parser")));
  }
  get parser() {
    const decode = this.decode;
    return decode === undefined ? this.decodeEffect : this.save("parser", withDecode(decode, () => this.decodeEffect));
  }
  get makeEffect() {
    const makeEffect = this.compiledMakeEffect;
    if (makeEffect !== undefined)
      return this.save("makeEffect", makeEffect);
    const child = (ast) => lazyParser(this.resolve, ast, "makeEffect");
    return this.save("makeEffect", compile(this.ast, child, (ast) => compileField(ast, child)));
  }
}
function withDecode(fastDecode, decodeEffect) {
  let detailed;
  return (input, options) => {
    if (input !== missing) {
      try {
        const value = fastDecode(input, options);
        if (value !== invalid2)
          return value === input ? sameExit : succeed8(value);
      } catch (error) {
        return die3(error);
      }
    }
    return (detailed ??= decodeEffect())(input, options);
  };
}
function lazyParser(resolve, ast, operation) {
  const entry = resolve(ast);
  if (entry.compiled === undefined || Object.hasOwn(entry, operation)) {
    return entry[operation];
  }
  let parser;
  return (input, options) => (parser ??= entry[operation])(input, options);
}
function resolve2(ast) {
  const cached = cache.get(ast);
  if (cached !== undefined)
    return cached;
  const entry = compiler === undefined ? new InterpretedEntry(ast) : new CompilerEntry(ast, compiler(ast, resolve2), resolve2);
  cache.set(ast, entry);
  return entry;
}

// ../../node_modules/effect/dist/SchemaParser.js
function makeEffect(schema) {
  const ast = schema.ast;
  let parser;
  return (input, options) => {
    return (parser ??= runWithCompiler(constructorCompiler, toType(ast)))(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit = runSyncExit2(parser(input, options));
    if (isSuccess3(exit)) {
      return some2(exit.value);
    }
    getSchemaIssueOrThrow(exit.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make13(schema) {
  return makeConstructorSync(toType(schema.ast));
}
function decodeUnknownEffect(schema, options) {
  const parser = run(schema.ast);
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
var mergeParseOptions = (options, overrideOptions) => overrideOptions ? {
  ...options,
  ...overrideOptions
} : options;
var getValue = (value) => {
  if (value === missing) {
    return fail6(new InvalidValue);
  }
  return succeed6(value);
};
function run(ast) {
  return runWithCompiler(normalCompiler, ast);
}
function parserResult(result, input) {
  if (isSameExit(result)) {
    return succeed6(input);
  }
  if (!effectIsExit(result)) {
    return flatMapEager2(result, getValue);
  }
  return result[args] === missing ? getValue(missing) : result;
}
function runWithCompiler(compiler, ast) {
  let parser;
  return (input, options) => {
    const result = (parser ??= compiler(ast))(input, options ?? defaultParseOptions);
    if (isSameExit(result)) {
      return succeed6(input);
    }
    if (!effectIsExit(result)) {
      return flatMapEager2(result, getValue);
    }
    return result[args] === missing ? getValue(missing) : result;
  };
}
function runSync3(effect, message) {
  const exit = runSyncExit2(effect);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  const issue = getSchemaIssueOrThrow(exit.cause, message);
  throw new Error("Schema validation failed", {
    cause: issue
  });
}
var constructorDefectMessage = "Constructor adapter can only throw schema issues";
function throwConstructorDefect(error) {
  throw new Error(constructorDefectMessage, {
    cause: die2(error)
  });
}
function makeConstructorSync(ast) {
  let entry;
  return (input, options) => constructSync(entry ??= resolve2(ast), input, options);
}
function constructSync(entry, input, options) {
  const parseOptions = options?.disableChecks ? options.parseOptions ? {
    ...options.parseOptions,
    disableChecks: true
  } : {
    disableChecks: true
  } : options?.parseOptions ?? defaultParseOptions;
  const make = entry.make;
  if (make !== undefined && input !== missing) {
    let output;
    try {
      output = make(input, parseOptions);
    } catch (error) {
      throwConstructorDefect(error);
    }
    if (output !== invalid2 && output !== missing)
      return output;
  }
  return runSync3(parserResult(entry.makeEffect(input, parseOptions), input), constructorDefectMessage);
}
function makeClassSync(ast, input, options, construct) {
  const entry = resolve2(ast);
  const descriptor = getConstructorDescriptor(ast);
  if (descriptor === undefined || entry.make !== undefined || entry.compiledMakeEffect !== undefined) {
    return constructSync(entry, input, options);
  }
  if (descriptor.isConstructed(input))
    return input;
  const fields = constructSync((entry.resolve ?? resolve2)(descriptor.link.to), input, options);
  try {
    return construct(fields);
  } catch (error) {
    throwConstructorDefect(error);
  }
}
var normalCompiler = (ast) => resolve2(ast).parser;
var constructorCompiler = (ast) => resolve2(ast).makeEffect;

// ../../node_modules/effect/dist/internal/schema/make.js
var TypeId20 = "~effect/Schema/Schema";
var RebuildOptions = /* @__PURE__ */ Symbol();
var SchemaProto = {
  [TypeId20]: TypeId20,
  get make() {
    const value = make13(this);
    Object.defineProperty(this, "make", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeEffect() {
    const value = makeEffect(this);
    Object.defineProperty(this, "makeEffect", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeOption() {
    const value = makeOption(this);
    Object.defineProperty(this, "makeOption", {
      value,
      enumerable: true
    });
    return value;
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  },
  rebuild(ast) {
    return make14(ast, this[RebuildOptions]);
  }
};
function make14(ast, options) {
  function Schema() {}
  const self = Object.setPrototypeOf(Schema, SchemaProto);
  if (options && (Object.hasOwn(options, "name") || Object.hasOwn(options, "length") || Object.hasOwn(options, "__proto__"))) {
    Object.defineProperties(self, Object.getOwnPropertyDescriptors({
      ...options
    }));
  } else {
    Object.assign(self, options);
  }
  self[RebuildOptions] = options;
  self.ast = ast;
  return self;
}

// ../../node_modules/effect/dist/internal/schema/toCodec.js
function toCodecJson(schema) {
  return make14(toCodecJsonAST(schema.ast), {
    schema
  });
}
var toCodecJsonAST = /* @__PURE__ */ makeCodecDerivation(toCodecJsonASTStep);
function makeCodecDerivation(step, options) {
  const deriveBody = memoize((owner) => {
    const body = replaceContext(owner, undefined);
    const out = step(body, recur);
    return out === body ? null : out;
  });
  const recur = applyToSelfOrLastLinkEncodingIdempotent((ast) => {
    const derived = deriveBody(getContextOwner(ast));
    if (derived === null)
      return ast;
    const out = replaceContext(derived, ast.context);
    return ast.context === undefined ? out : replaceContextLastLink(out, withoutConstructorDefault(ast.context));
  }, options);
  return recur;
}
function withoutConstructorDefault(context) {
  return context.constructorDefault === undefined ? context : new Context(context.isOptional, context.isMutable, undefined, context.annotations);
}
function validateCanonicalObjectPropertyNames(ast) {
  if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
    throw new globalThis.Error("Objects property names must be strings", {
      cause: ast
    });
  }
}
function makeReorder(getPriority) {
  return (types) => {
    const sortedTypes = [...types].sort((a, b) => getPriority(toEncoded(a)) - getPriority(toEncoded(b)));
    const orderChanged = sortedTypes.some((ast, index) => ast !== types[index]);
    if (!orderChanged)
      return types;
    return sortedTypes;
  };
}
var toCodecJsonReorder = /* @__PURE__ */ makeReorder((ast) => {
  switch (ast._tag) {
    case "BigInt":
    case "Symbol":
    case "UniqueSymbol":
      return 0;
    default:
      return 1;
  }
});
function toCodecJsonASTStep(ast, recur) {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.toCodecJson ?? ast.annotations?.toCodec;
      if (!isFunction(getLink)) {
        return replaceEncoding(ast, [unknownToJson]);
      }
      const typeParameters = ast.typeParameters.map((tp) => make14(toEncoded(tp)));
      const link = getLink(typeParameters);
      return link === undefined ? ast : replaceEncoding(ast, [mapLink(link, recur)]);
    }
    case "Unknown":
      return replaceEncoding(ast, [unknownToJson]);
    case "ObjectKeyword":
      return replaceEncoding(ast, [objectKeywordToJson]);
    case "Undefined":
    case "Void":
    case "Literal":
    case "Number":
      return ast.toCodecJson();
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Objects": {
      validateCanonicalObjectPropertyNames(ast);
      return ast.recur(recur, parameterFromString);
    }
    case "Union": {
      const sortedTypes = toCodecJsonReorder(ast.types);
      if (sortedTypes !== ast.types) {
        return new Union(sortedTypes, ast.options, ast.annotations, ast.checks, ast.encoding, ast.context, ast.encodingChecks).recur(recur);
      }
      return ast.recur(recur);
    }
    case "Arrays":
    case "Suspend":
      return ast.recur(recur);
  }
  return ast;
}

// ../../node_modules/effect/dist/Struct.js
var lambda = (f) => f;

// ../../node_modules/effect/dist/internal/schemaError.js
var SchemaErrorTypeId = "~effect/Schema/SchemaError";

// ../../node_modules/effect/dist/Bytes.js
var Equivalence4 = /* @__PURE__ */ make((self, that) => {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
});

// ../../node_modules/effect/dist/net/NetAddress.js
var TypeId21 = "~effect/net/NetAddress";
var ipv4Value = (self) => self.value;
var ipv6Words = (self) => self;
var getMacBytes = (self) => self.bytes;

class NetAddressError extends (/* @__PURE__ */ TaggedError2("NetAddressError")) {
}
var isAddress = (u) => hasProperty(u, TypeId21);
var isIpv4Address = (u) => isAddress(u) && u._tag === "Ipv4Address";
var isIpv6Address = (u) => isAddress(u) && u._tag === "Ipv6Address";
var width = (address) => isIpv4Address(address) ? 32 : 128;
var isMacAddress = (u) => isAddress(u) && u._tag === "MacAddress";
var isInetAddressV4 = (u) => isAddress(u) && u._tag === "InetAddressV4";
var isInetAddressV6 = (u) => isAddress(u) && u._tag === "InetAddressV6";
var isUnixPathAddress = (u) => isAddress(u) && u._tag === "UnixPathAddress";
var Ipv4Proto = {
  ...BaseProto,
  _tag: "Ipv4Address",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    return isIpv4Address(that) && ipv4Value(this) === ipv4Value(that);
  },
  [symbol]() {
    return optimize(combine(ipv4HashSeed, ipv4Value(this) | 0));
  },
  toString() {
    return formatIp(this);
  },
  toJSON() {
    return this.toString();
  }
};
var Ipv6Proto = {
  ...BaseProto,
  _tag: "Ipv6Address",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    if (!isIpv6Address(that))
      return false;
    const self = ipv6Words(this);
    const other = ipv6Words(that);
    return self.w0 === other.w0 && self.w1 === other.w1 && self.w2 === other.w2 && self.w3 === other.w3;
  },
  [symbol]() {
    const self = ipv6Words(this);
    let h = combine(ipv6HashSeed, self.w0 | 0);
    h = combine(h, self.w1 | 0);
    h = combine(h, self.w2 | 0);
    return optimize(combine(h, self.w3 | 0));
  },
  toString() {
    return formatIp(this);
  },
  toJSON() {
    return this.toString();
  }
};
var MacProto = {
  ...BaseProto,
  _tag: "MacAddress",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    return isMacAddress(that) && Equivalence4(getMacBytes(this), getMacBytes(that));
  },
  [symbol]() {
    return combine(macHashSeed, array(getMacBytes(this)));
  },
  toString() {
    return formatMacAddress(this);
  },
  toJSON() {
    return this.toString();
  }
};
var ipv4HashSeed = /* @__PURE__ */ string("Ipv4Address");
var ipv6HashSeed = /* @__PURE__ */ string("Ipv6Address");
var macHashSeed = /* @__PURE__ */ string("MacAddress");
var makeIpv4 = (value) => {
  const self = Object.create(Ipv4Proto);
  self.value = value >>> 0;
  return Object.freeze(self);
};
var makeIpv6 = (w0, w1, w2, w3) => {
  const self = Object.create(Ipv6Proto);
  self.w0 = w0 >>> 0;
  self.w1 = w1 >>> 0;
  self.w2 = w2 >>> 0;
  self.w3 = w3 >>> 0;
  return Object.freeze(self);
};
var packOctets = (a, b, c, d) => (a << 24 | b << 16 | c << 8 | d) >>> 0;
var packBytes = (bytes, offset) => packOctets(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
var wordToOctets = (word) => [word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255];
var ipv4FromBytesUnsafe = (bytes) => makeIpv4(packBytes(bytes, 0));
var ipv6FromBytesUnsafe = (bytes) => makeIpv6(packBytes(bytes, 0), packBytes(bytes, 4), packBytes(bytes, 8), packBytes(bytes, 12));
var addressError = (input, message) => fail2(new NetAddressError({
  input,
  message
}));
var allIntegersInRange = (values, max) => {
  for (let i = 0;i < values.length; i++) {
    const n = values[i];
    if (!Number.isInteger(n) || n < 0 || n > max)
      return false;
  }
  return true;
};
var ipv4FromOctets = (octets) => {
  if (!allIntegersInRange(octets, 255)) {
    return addressError(octets, "octets must be integers from 0 through 255");
  }
  return succeed2(makeIpv4(packOctets(octets[0], octets[1], octets[2], octets[3])));
};
var ipv6FromSegments = (segments) => {
  if (!allIntegersInRange(segments, 65535)) {
    return addressError(segments, "segments must be integers from 0 through 65535");
  }
  return succeed2(makeIpv6(segments[0] * 65536 + segments[1], segments[2] * 65536 + segments[3], segments[4] * 65536 + segments[5], segments[6] * 65536 + segments[7]));
};
var ipv4FromString = (input) => {
  const parts = input.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return addressError(input, "expected exactly four decimal octets");
  }
  if (parts.some((part) => part.length > 1 && part[0] === "0")) {
    return addressError(input, "leading zeroes are not allowed");
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) {
    return addressError(input, "octets must be at most 255");
  }
  return ipv4FromOctets([octets[0], octets[1], octets[2], octets[3]]);
};
var parseIpv6Segments = (input) => {
  if (input.includes("[") || input.includes("]") || input.includes("%")) {
    return addressError(input, "brackets and zone identifiers are not valid in a bare IPv6 address");
  }
  const halves = input.split("::");
  if (halves.length > 2)
    return addressError(input, "only one compression marker is allowed");
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  if (head.some((part) => part === "") || tail.some((part) => part === "")) {
    return addressError(input, "empty segments are only valid in the compression marker");
  }
  const trailing = tail.length > 0 ? tail[tail.length - 1] : head.length > 0 ? head[head.length - 1] : "";
  let embedded;
  if (trailing.includes(".")) {
    if (halves.length === 2 && tail.length === 0) {
      return addressError(input, "embedded IPv4 syntax must be trailing");
    }
    const parsed = map(ipv4FromString(trailing), (address) => {
      const value = ipv4Value(address);
      return [value >>> 16, value & 65535];
    });
    if (isFailure2(parsed))
      return parsed;
    embedded = parsed.success;
    if (tail.length > 0)
      tail.pop();
    else
      head.pop();
  }
  const explicit = head.length + tail.length + (embedded ? 2 : 0);
  if (halves.length === 1 ? explicit !== 8 : explicit >= 8) {
    return addressError(input, halves.length === 1 ? "expected eight segments" : "compression must replace at least one segment");
  }
  const parse = (part) => /^[0-9a-fA-F]{1,4}$/.test(part) ? Number.parseInt(part, 16) : undefined;
  const parsedHead = head.map(parse);
  const parsedTail = tail.map(parse);
  if (parsedHead.some((part) => part === undefined) || parsedTail.some((part) => part === undefined)) {
    return addressError(input, "segments must contain one through four hexadecimal digits");
  }
  return succeed2([...parsedHead, ...Array(8 - explicit).fill(0), ...parsedTail, ...embedded ?? []]);
};
var ipv6FromString = (input) => {
  return flatMap(parseIpv6Segments(input), (segments) => ipv6FromSegments(segments));
};
var ipFromString = (input) => {
  const result = input.includes(":") ? ipv6FromString(input) : ipv4FromString(input);
  return result;
};
var ipv4ToOctets = (self) => wordToOctets(ipv4Value(self));
var ipv6ToSegments = (self) => {
  const {
    w0,
    w1,
    w2,
    w3
  } = ipv6Words(self);
  return [w0 >>> 16, w0 & 65535, w1 >>> 16, w1 & 65535, w2 >>> 16, w2 & 65535, w3 >>> 16, w3 & 65535];
};
var ipv6ToOctets = (self) => {
  const {
    w0,
    w1,
    w2,
    w3
  } = ipv6Words(self);
  return [...wordToOctets(w0), ...wordToOctets(w1), ...wordToOctets(w2), ...wordToOctets(w3)];
};
var formatMacAddress = (self) => Array.from(getMacBytes(self), (byte) => byte.toString(16).padStart(2, "0")).join(":");
var formatIp = (self) => {
  if (isIpv4Address(self))
    return ipv4ToOctets(self).join(".");
  const segments = ipv6ToSegments(self);
  if (isIpv4Mapped(self)) {
    return `::ffff:${segments[6] >> 8}.${segments[6] & 255}.${segments[7] >> 8}.${segments[7] & 255}`;
  }
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let index = 0;index <= 8; index++) {
    if (index < 8 && segments[index] === 0) {
      if (start === -1)
        start = index;
    } else if (start !== -1) {
      if (index - start > bestLength) {
        bestStart = start;
        bestLength = index - start;
      }
      start = -1;
    }
  }
  if (bestLength < 2)
    return segments.map((segment) => segment.toString(16)).join(":");
  const head = segments.slice(0, bestStart).map((segment) => segment.toString(16)).join(":");
  const tail = segments.slice(bestStart + bestLength).map((segment) => segment.toString(16)).join(":");
  return `${head}::${tail}`;
};
var isIpv4Mapped = (self) => {
  const {
    w0,
    w1,
    w2
  } = ipv6Words(self);
  return w0 === 0 && w1 === 0 && w2 === 65535;
};
var InetV4Proto = {
  ...BaseProto,
  _tag: "InetAddressV4",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    return isInetAddressV4(that) && this.port === that.port && equals(this.address, that.address);
  },
  [symbol]() {
    return combine(hash(this.address), number(this.port));
  },
  toString() {
    return formatInet(this);
  },
  toJSON() {
    return this.toString();
  }
};
var InetV6Proto = {
  ...BaseProto,
  _tag: "InetAddressV6",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    return isInetAddressV6(that) && this.port === that.port && this.scopeId === that.scopeId && equals(this.address, that.address);
  },
  [symbol]() {
    return combine(combine(hash(this.address), number(this.port)), number(this.scopeId));
  },
  toString() {
    return formatInet(this);
  },
  toJSON() {
    return this.toString();
  }
};
var formatHost = (self) => formatIp(self.address) + (isInetAddressV6(self) && self.scopeId !== 0 ? `%${self.scopeId}` : "");
var formatInet = (self) => {
  const host = formatHost(self);
  return isInetAddressV4(self) ? `${host}:${self.port}` : `[${host}]:${self.port}`;
};
var UnixPathProto = {
  ...BaseProto,
  _tag: "UnixPathAddress",
  [TypeId21]: TypeId21,
  [symbol2](that) {
    return isUnixPathAddress(that) && this.path === that.path;
  },
  [symbol]() {
    return combine(string("UnixPathAddress"), string(this.path));
  },
  toString() {
    return this.path;
  },
  toJSON() {
    return this.toString();
  }
};

// ../../node_modules/effect/dist/net/IpInterface.js
var TypeId22 = "~effect/net/IpInterface";
var isIpInterface = (u) => hasProperty(u, TypeId22);
var IpInterfaceProto = {
  ...BaseProto,
  _tag: "IpInterface",
  [TypeId22]: TypeId22,
  [symbol2](that) {
    return isIpInterface(that) && this.prefixLength === that.prefixLength && equals(this.address, that.address);
  },
  [symbol]() {
    return combine(hash(this.address), number(this.prefixLength));
  },
  toString() {
    return format3(this);
  },
  toJSON() {
    return this.toString();
  }
};
var interfaceError = (input, message) => fail2(new NetAddressError({
  input,
  message
}));
var make15 = (address, prefixLength) => {
  const max = width(address);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > max) {
    return interfaceError(address, `prefix length must be an integer from 0 through ${max}`);
  }
  const self = Object.assign(Object.create(IpInterfaceProto), {
    address,
    prefixLength
  });
  return succeed2(Object.freeze(self));
};
var parseAddressWithPrefix = (input, options) => {
  const slash = input.indexOf("/");
  if (slash === -1 && options?.prefix !== "required") {
    return succeed2({
      address: input,
      prefixLength: undefined
    });
  }
  if (slash <= 0 || slash !== input.lastIndexOf("/") || slash === input.length - 1) {
    return interfaceError(input, "expected an address and prefix length separated by one slash");
  }
  const prefix = input.slice(slash + 1);
  if (!/^(0|[1-9][0-9]*)$/.test(prefix)) {
    return interfaceError(input, "prefix length must be an unpadded ASCII decimal integer");
  }
  return succeed2({
    address: input.slice(0, slash),
    prefixLength: Number(prefix)
  });
};
var fromString = (input, options) => flatMap(parseAddressWithPrefix(input, options), (parts) => flatMap(ipFromString(parts.address), (address) => make15(address, parts.prefixLength ?? width(address))));
var makeUnsafe6 = (address, prefixLength) => getOrThrow(make15(address, prefixLength));
var format3 = (self) => `${formatIp(self.address)}/${self.prefixLength}`;

// ../../node_modules/effect/dist/net/IpNetwork.js
var TypeId23 = "~effect/net/IpNetwork";
var isIpNetwork = (u) => hasProperty(u, TypeId23);
var IpNetworkProto = {
  ...BaseProto,
  _tag: "IpNetwork",
  [TypeId23]: TypeId23,
  [symbol2](that) {
    return isIpNetwork(that) && this.prefixLength === that.prefixLength && equals(this.address, that.address);
  },
  [symbol]() {
    return combine(hash(this.address), number(this.prefixLength));
  },
  toString() {
    return format4(this);
  },
  toJSON() {
    return this.toString();
  }
};
var fromInterfaceValue = (value) => {
  const self = Object.assign(Object.create(IpNetworkProto), {
    address: value.address,
    prefixLength: value.prefixLength
  });
  return Object.freeze(self);
};
var toBytes = (address) => isIpv4Address(address) ? ipv4ToOctets(address) : ipv6ToOctets(address);
var maskBytes = (bytes, prefixLength) => {
  const wholeBytes = Math.floor(prefixLength / 8);
  const partialBits = prefixLength % 8;
  return bytes.map((byte, index) => {
    if (index < wholeBytes)
      return byte;
    if (index === wholeBytes && partialBits !== 0)
      return byte & (255 << 8 - partialBits & 255);
    return 0;
  });
};
var make16 = (address, prefixLength) => {
  return flatMap(make15(address, prefixLength), (value) => {
    const bytes = toBytes(address);
    const masked = maskBytes(bytes, prefixLength);
    if (bytes.some((byte, index) => byte !== masked[index])) {
      return fail2(new NetAddressError({
        input: address,
        message: "address has non-zero host bits"
      }));
    }
    return succeed2(fromInterfaceValue(value));
  });
};
var format4 = (self) => `${formatIp(self.address)}/${self.prefixLength}`;

// ../../node_modules/effect/dist/Schema.js
var TypeId24 = TypeId20;
function declareConstructor() {
  return (typeParameters, run, annotations) => {
    return make17(new Declaration(typeParameters.map(getAST), (typeParameters) => run(typeParameters.map((ast) => make17(ast))), annotations));
  };
}
function declare(is, annotations) {
  return declareConstructor()([], () => (input, ast, options) => is(input) ? succeed6(input) : fail6(new InvalidType(ast, input, options)), annotations);
}
class SchemaError extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    const stackTraceLimit = getStackTraceLimit();
    setStackTraceLimit(0);
    try {
      super({
        issue
      });
    } finally {
      setStackTraceLimit(stackTraceLimit);
    }
  }
  get message() {
    return defaultFormatter(this.issue);
  }
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
}
function fromIssueEffect(self) {
  if (effectIsExit(self)) {
    return fromIssueExit(self);
  }
  return catchCause2(self, (cause) => failCauseSync2(() => map5(cause, (issue) => new SchemaError(issue))));
}
function fromIssueExit(exit) {
  return isSuccess3(exit) ? exit : failCause2(map5(exit.cause, (issue) => new SchemaError(issue)));
}
function decodeUnknownEffect2(schema, options) {
  const parser = decodeUnknownEffect(schema, options);
  return (input, options) => {
    return fromIssueEffect(parser(input, options));
  };
}
var decodeEffect2 = decodeUnknownEffect2;
var make17 = make14;
function isSchema(u) {
  return hasProperty(u, TypeId24) && u[TypeId24] === TypeId24;
}
var optional2 = /* @__PURE__ */ lambda((self) => {
  const schema = UndefinedOr(self);
  return make17(optional(self.ast), {
    schema
  });
});
function Literal2(literal) {
  const out = make17(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
var Unknown2 = /* @__PURE__ */ make17(unknown);
var Null2 = /* @__PURE__ */ make17(null_);
var Undefined2 = /* @__PURE__ */ make17(undefined_3);
var String4 = /* @__PURE__ */ make17(string2);
var Number5 = /* @__PURE__ */ make17(number2);
function makeStruct(ast, fields) {
  return make17(ast, {
    fields,
    mapFields(f, options) {
      const fields = f(this.fields);
      return makeStruct(struct(fields, options?.unsafePreserveChecks ? this.ast.checks : undefined), fields);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, undefined), fields);
}
function makeUnion(ast, members) {
  return make17(ast, {
    members,
    mapMembers(f, options) {
      const members = f(this.members);
      return makeUnion(union(members, this.ast.options, options?.unsafePreserveChecks ? this.ast.checks : undefined), members);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union(members, options, undefined), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make17(union(members, undefined, undefined), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals) {
      return Literals(literals);
    },
    transform(to) {
      return Union2(members.map((member, index) => member.transform(to[index])));
    }
  });
}
var NullOr = /* @__PURE__ */ lambda((self) => Union2([self, Null2]));
var UndefinedOr = /* @__PURE__ */ lambda((self) => Union2([self, Undefined2]));
function decodeTo2(to, transformation) {
  return (from) => {
    return make17(decodeTo(from.ast, to.ast, transformation ? makeTransformation(transformation) : passthrough3()), {
      from,
      to
    });
  };
}
function withConstructorDefault2(defaultValue) {
  return (schema) => make17(withConstructorDefault(schema.ast, defaultValue), {
    schema
  });
}
function tag(literal) {
  return Literal2(literal).pipe(withConstructorDefault2(succeed6(literal)));
}
function TaggedStruct(value, fields) {
  return Struct({
    _tag: tag(value),
    ...fields
  });
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo, transformation) => {
    return new Link(encodeTo.ast, makeTransformation(transformation));
  };
}
var makeFilter2 = makeFilter;
function isPattern2(regExp, annotations) {
  const source = regExp.source;
  const flags = regExp.flags;
  const canExport = /^[dg]*uy?$/.test(flags);
  const runtimeRegExp = flags === "" ? `new globalThis.RegExp(${format(source)})` : `new globalThis.RegExp(${format(source)}, ${format(flags)})`;
  return isPattern(regExp, {
    toJsonSchema: () => canExport ? {
      pattern: flags.endsWith("y") ? `^(?:${source})` : source
    } : [{}, true],
    toCode: () => ({
      runtime: `Schema.isPattern(${runtimeRegExp})`
    }),
    ...annotations
  });
}
function isBase64(annotations) {
  const pattern = "^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$";
  const regExp = /^[0-9a-zA-Z+/]*={0,2}$/;
  return makeFilter2((s) => s.length % 4 === 0 && regExp.test(s), {
    expected: "a base64 encoded string",
    representation: {
      id: "effect/schema/isBase64",
      payload: null
    },
    toJsonSchema: () => ({
      pattern
    }),
    arbitraryConstraint: {
      patterns: [{
        source: pattern,
        flags: ""
      }]
    },
    toCode: () => ({
      runtime: "Schema.isBase64()"
    }),
    ...annotations
  });
}
var Finite = /* @__PURE__ */ make17(finite);
function makeIsGreaterThan(options) {
  const gt = isGreaterThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMinimum, annotations) => {
    return makeFilter2((input) => gt(input, exclusiveMinimum), {
      expected: `a value greater than ${formatter(exclusiveMinimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum: exclusiveMinimum,
        exclusiveMinimum: true
      },
      ...options.annotate?.(exclusiveMinimum),
      ...annotations
    });
  };
}
function makeIsLessThanOrEqualTo(options) {
  const lte = isLessThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (maximum, annotations) => {
    return makeFilter2((input) => lte(input, maximum), {
      expected: `a value less than or equal to ${formatter(maximum)}`,
      arbitraryConstraint: {
        order: options.order,
        maximum
      },
      ...options.annotate?.(maximum),
      ...annotations
    });
  };
}
function encodeNumberPayload(number) {
  if (!globalThis.Number.isFinite(number)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${format(number)}`);
  }
  return number;
}
var isGreaterThan2 = /* @__PURE__ */ makeIsGreaterThan({
  order: Number2,
  annotate: (exclusiveMinimum) => ({
    representation: {
      id: "effect/schema/isGreaterThan",
      payload: {
        exclusiveMinimum: encodeNumberPayload(exclusiveMinimum)
      }
    },
    toJsonSchema: () => ({
      exclusiveMinimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThan(${format(exclusiveMinimum)})`
    })
  })
});
var isLessThanOrEqualTo3 = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Number2,
  annotate: (maximum) => ({
    representation: {
      id: "effect/schema/isLessThanOrEqualTo",
      payload: {
        maximum: encodeNumberPayload(maximum)
      }
    },
    toJsonSchema: () => ({
      maximum
    }),
    toCode: () => ({
      runtime: `Schema.isLessThanOrEqualTo(${format(maximum)})`
    })
  })
});
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    representation: {
      id: "effect/schema/isInt",
      payload: null
    },
    toJsonSchema: () => ({
      type: "integer",
      minimum: globalThis.Number.MIN_SAFE_INTEGER,
      maximum: globalThis.Number.MAX_SAFE_INTEGER
    }),
    toCode: () => ({
      runtime: "Schema.isInt()"
    }),
    arbitraryConstraint: {
      number: "integer"
    },
    ...annotations
  });
}
var Int = /* @__PURE__ */ Number5.check(/* @__PURE__ */ isInt());
function makeIsMinLength(minLength, minCodePoints, annotations) {
  return makeFilter2((input) => input.length >= minLength, {
    expected: `a value with a length of at least ${minLength}`,
    representation: {
      id: "effect/schema/isMinLength",
      payload: {
        minLength
      }
    },
    toJsonSchema: ({
      type
    }) => type === "string" ? minLength <= 1 ? {
      minLength: minCodePoints
    } : [{
      minLength: minCodePoints
    }, true] : type === "array" ? {
      minItems: minLength
    } : type === undefined ? [{
      minLength: minCodePoints,
      minItems: minLength
    }, true] : [{}, true],
    toCode: () => ({
      runtime: `Schema.isMinLength(${minLength})`
    }),
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitraryConstraint: {
      minLength
    },
    ...annotations
  });
}
function isNonEmpty(annotations) {
  return makeIsMinLength(1, 1, annotations);
}
var NonEmptyString = /* @__PURE__ */ String4.check(/* @__PURE__ */ isNonEmpty());
var getErrorOptionsKey = (options) => (options?.includeStack === true ? 1 : 0) | (options?.excludeCause === true ? 2 : 0);
var getErrorOptions = (key) => {
  switch (key) {
    case 0:
      return;
    case 1:
      return {
        includeStack: true
      };
    case 2:
      return {
        excludeCause: true
      };
    case 3:
      return {
        includeStack: true,
        excludeCause: true
      };
  }
};
var defectSchemaCache = [];
function Defect(options) {
  const key = getErrorOptionsKey(options);
  const cached = defectSchemaCache[key];
  if (cached !== undefined) {
    return cached;
  }
  const schema = Json2.pipe(decodeTo2(Unknown2, defectFromJson(getErrorOptions(key))));
  defectSchemaCache[key] = schema;
  return schema;
}
var RegExp2 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  representation: {
    id: "effect/schema/RegExp",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  }),
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String4,
    flags: String4
  }), transformEffect2({
    decode: (e, options) => try_3({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: () => new InvalidValue({
        expected: "valid RegExp source and flags"
      }, e, options)
    }),
    encode: (regExp) => succeed6({
      source: regExp.source,
      flags: regExp.flags
    })
  }))
});
var URLString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  representation: {
    id: "effect/schema/URL",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  }),
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString)
});
var JsonString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as JSON"
});
function fromJsonString2(schema, options) {
  return JsonString.pipe(decodeTo2(schema, fromJsonString(options)));
}
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  representation: {
    id: "effect/schema/File",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.File`,
    Type: `globalThis.File`
  }),
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String4.check(isBase64()),
    type: String4,
    name: String4,
    lastModified: Int
  }), transformEffect2({
    decode: (e, options) => match2(decode(e.data), {
      onFailure: () => fail6(new InvalidValue({
        expected: "a valid Base64 string"
      }, e.data, options)),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed6(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file, options) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encode(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: () => new InvalidValue({
        expected: "a readable File"
      }, file, options)
    })
  }))
});
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  representation: {
    id: "effect/schema/URLSearchParams",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  }),
  expected: "URLSearchParams",
  toCodecJson: () => link()(String4.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
var FiniteFromString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a finite number"
}).pipe(/* @__PURE__ */ decodeTo2(Finite, numberFromString));
var Base64String = /* @__PURE__ */ String4.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  representation: {
    id: "effect/schema/Uint8Array",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  }),
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String)
});
var arbitraryMinimumDateTimestamp = -8640000000000000;
var arbitraryMaximumDateTimestamp = 8640000000000000;
var arbitraryMinimumZonedDateTimeTimestamp = arbitraryMinimumDateTimestamp + 14 * 60 * 60 * 1000;
var arbitraryMaximumZonedDateTimeTimestamp = arbitraryMaximumDateTimestamp - 14 * 60 * 60 * 1000;
var arbitraryMinimumTimeZoneOffset = -12 * 60 * 60 * 1000;
var arbitraryMaximumTimeZoneOffset = 14 * 60 * 60 * 1000;
var immerable = /* @__PURE__ */ globalThis.Symbol.for("immer-draftable");
var payloadToken = {};
function makeClass(Inherited, identifier, struct2, annotations, proto) {
  const getClassSchema = getClassSchemaFactory(struct2, identifier, annotations);
  const ClassTypeId = getClassTypeId(identifier);
  const out = class extends Inherited {
    constructor(...[input, options]) {
      const internalOptions = options;
      const payload = internalOptions?.["~payload"];
      const value = payload?.token === payloadToken ? payload.value : struct2.make(input ?? {}, options);
      super(value, {
        ...options,
        disableChecks: true,
        "~payload": {
          token: payloadToken,
          value
        }
      });
    }
    static [TypeId24] = TypeId24;
    get [ClassTypeId]() {
      return ClassTypeId;
    }
    static [immerable] = true;
    static identifier = identifier;
    static fields = struct2.fields;
    static get ast() {
      return getClassSchema(this).ast;
    }
    static pipe() {
      return pipeArguments(this, arguments);
    }
    static rebuild(ast) {
      return getClassSchema(this).rebuild(ast);
    }
    static make(input, options) {
      return makeClassSync(toType(getClassSchema(this).ast), input ?? {}, options, (fields) => makeClassTrusted(this, fields));
    }
    static makeOption(input, options) {
      return makeOption(getClassSchema(this))(input ?? {}, options);
    }
    static makeEffect(input, options) {
      return getClassSchema(this).makeEffect(input ?? {}, options);
    }
    static annotate(annotations) {
      return this.rebuild(annotate(this.ast, annotations));
    }
    static annotateKey(annotations) {
      return this.rebuild(annotateKey(this.ast, annotations));
    }
    static check(...checks) {
      return this.rebuild(appendChecks(this.ast, checks));
    }
    static extend(identifier2) {
      return (schema, annotations) => {
        const extension = isStruct(schema) ? schema : Struct(schema);
        const fields = {
          ...struct2.fields,
          ...extension.fields
        };
        const ast = struct(fields, struct2.ast.checks, {
          identifier: identifier2
        });
        return makeClass(this, identifier2, makeStruct(appendChecks(ast, extension.ast.checks), fields), annotations, proto);
      };
    }
    static mapFields(f, options) {
      return struct2.mapFields(f, options);
    }
  };
  if (proto !== undefined) {
    Object.assign(out.prototype, proto(identifier));
  }
  return out;
}
function makeClassTrusted(self, fields) {
  return new self(fields, {
    "~payload": {
      token: payloadToken,
      value: fields
    }
  });
}
function getClassTransformation(self) {
  return new Transformation(transform((input) => makeClassTrusted(self, input)), passthrough2());
}
function getClassTypeId(identifier) {
  return `~effect/Schema/Class/${identifier}`;
}
function getClassSchemaFactory(from, identifier, annotations) {
  let memo;
  return (self) => {
    if (memo !== undefined) {
      return memo;
    }
    const ClassTypeId = getClassTypeId(identifier);
    const isClassValue = (input) => input instanceof self || hasProperty(input, ClassTypeId);
    const transformation = getClassTransformation(self);
    const to = make17(new Declaration([from.ast], () => (input, ast, options) => {
      return isClassValue(input) ? succeed6(input) : fail6(new InvalidType(ast, input, options));
    }, {
      identifier,
      [CONSTRUCTOR_ANNOTATION_KEY]: ([from]) => ({
        isConstructed: isClassValue,
        link: new Link(from, transformation)
      }),
      toCodec: ([from]) => new Link(from.ast, transformation),
      toEquivalence: ([from]) => from,
      toFormatter: ([from]) => (t) => `${self.identifier}(${from(t)})`,
      [SENTINELS_ANNOTATION_KEY]: collectSentinels(from.ast),
      ...annotations
    }));
    return memo = decodeTo2(to, transformation)(from);
  };
}
function isStruct(schema) {
  return isSchema(schema);
}
var Error3 = (identifier) => (schema, annotations) => {
  const struct = isStruct(schema) ? schema : Struct(schema);
  const self = makeClass(Error2, identifier, struct, annotations, (identifier) => ({
    name: identifier
  }));
  return self;
};
var TaggedError3 = (identifier) => {
  return (tagValue, schema, annotations) => {
    const struct = isStruct(schema) ? schema.mapFields((fields) => ({
      _tag: tag(tagValue),
      ...fields
    }), {
      unsafePreserveChecks: true
    }) : TaggedStruct(tagValue, schema);
    return Error3(identifier ?? tagValue)(struct, annotations);
  };
};
var toCodecJson2 = toCodecJson;
var Json2 = /* @__PURE__ */ make17(/* @__PURE__ */ annotate(Json, {
  toCode: () => ({
    runtime: "Schema.Json",
    Type: "Schema.Json"
  })
}));

// ../../node_modules/effect/dist/reactivity/Reactivity.js
var TypeId25 = "~effect/reactivity/Reactivity";
var Reactivity = /* @__PURE__ */ Service("effect/reactivity/Reactivity");
var make18 = /* @__PURE__ */ sync2(() => {
  const handlers = new Map;
  const runHandlers = (hashes) => {
    const ran = new Set;
    for (const hash of hashes) {
      handlers.get(hash)?.forEach((run) => {
        if (ran.has(run))
          return;
        ran.add(run);
        run();
      });
    }
  };
  const invalidateUnsafe = (keys) => {
    const hashes = new Set;
    keysToHashes(keys, (hash) => hashes.add(hash));
    runHandlers(hashes);
  };
  const invalidate = (keys) => contextWith2((services) => {
    const pending = getOrUndefined2(services, PendingInvalidation);
    if (pending) {
      keysToHashes(keys, (hash) => {
        pending.add(hash);
      });
    } else {
      invalidateUnsafe(keys);
    }
    return void_4;
  });
  const mutation = (keys, effect) => tap2(effect, invalidate(keys));
  const registerUnsafe = (keys, handler) => {
    const resolvedKeys = [];
    keysToHashes(keys, (hash) => {
      resolvedKeys.push(hash);
      let set = handlers.get(hash);
      if (set === undefined) {
        set = new Set;
        handlers.set(hash, set);
      }
      set.add(handler);
    });
    return () => {
      for (let i = 0;i < resolvedKeys.length; i++) {
        const set = handlers.get(resolvedKeys[i]);
        if (set === undefined)
          continue;
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(resolvedKeys[i]);
        }
      }
    };
  };
  const query = (keys, effect) => gen2(function* () {
    const services = yield* context2();
    const scope = get(services, Scope);
    const results = yield* make9();
    const runFork = flow(runForkWith2(services), runIn(scope));
    let running = false;
    let pending = false;
    let stopped = false;
    const handleExit = (exit) => {
      if (exit._tag === "Failure") {
        stopped = true;
        pending = false;
        running = false;
        cancel();
        failCauseUnsafe(results, exit.cause);
        return;
      } else {
        offerUnsafe(results, exit.value);
      }
      if (pending) {
        pending = false;
        runFork(effect).addObserver(handleExit);
      } else {
        running = false;
      }
    };
    function run() {
      if (stopped)
        return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      runFork(effect).addObserver(handleExit);
    }
    const cancel = registerUnsafe(keys, run);
    yield* addFinalizer(scope, sync2(cancel));
    run();
    return results;
  });
  const stream = (tables, effect) => query(tables, effect).pipe(map6(fromQueue), unwrap2);
  const withBatch = (effect) => suspend2(() => {
    const pending = new Set;
    return effect.pipe(provideService2(PendingInvalidation, pending), onExit2((_) => sync2(() => runHandlers(pending))));
  });
  return Reactivity.of({
    [TypeId25]: TypeId25,
    mutation,
    query,
    stream,
    invalidateUnsafe,
    invalidate,
    registerUnsafe,
    withBatch
  });
});

class PendingInvalidation extends (/* @__PURE__ */ Service()("effect/reactivity/Reactivity/PendingInvalidation")) {
}
var layer = /* @__PURE__ */ effect(Reactivity)(make18);
function stringOrHash(u) {
  switch (typeof u) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      return String(u);
    default:
      return hash(u);
  }
}
var keysToHashes = (keys, f) => {
  if (Array.isArray(keys)) {
    for (let i = 0;i < keys.length; i++) {
      f(stringOrHash(keys[i]));
    }
    return;
  }
  for (const key in keys) {
    f(key);
    const ids = keys[key];
    for (let i = 0;i < ids.length; i++) {
      f(`${key}:${stringOrHash(ids[i])}`);
    }
  }
};

// ../../node_modules/effect/dist/internal/sql.js
var CurrentTransactionService = /* @__PURE__ */ Reference("effect/sql/CurrentTransactionService", {
  defaultValue: () => {
    return;
  }
});
var waitClock = (fiber) => fiber.getRef(TracerTimingEnabled) ? fiber.getRef(Clock) : undefined;
var recordConnectionWait = (span, clock) => span.attribute("db.client.connection.wait_time_ms", Number(clock.currentTimeNanosUnsafe() - span.status.startTime) / 1e6);

// ../../node_modules/effect/dist/sql/SqlError.js
var TypeId26 = "~effect/sql/SqlError";
var ReasonTypeId = "~effect/sql/SqlError/Reason";
var ReasonFields = {
  cause: /* @__PURE__ */ Defect(),
  message: /* @__PURE__ */ optional2(String4),
  operation: /* @__PURE__ */ optional2(String4)
};

class ConnectionError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/ConnectionError")("ConnectionError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return true;
  }
}

class AuthenticationError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/AuthenticationError")("AuthenticationError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}

class AuthorizationError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/AuthorizationError")("AuthorizationError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}

class SqlSyntaxError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/SqlSyntaxError")("SqlSyntaxError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}
var UniqueViolationFields = {
  ...ReasonFields,
  constraint: String4
};

class UniqueViolation extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/UniqueViolation")("UniqueViolation", UniqueViolationFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}

class ConstraintError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/ConstraintError")("ConstraintError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}

class DeadlockError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/DeadlockError")("DeadlockError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return true;
  }
}

class SerializationError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/SerializationError")("SerializationError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return true;
  }
}

class LockTimeoutError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/LockTimeoutError")("LockTimeoutError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return true;
  }
}

class StatementTimeoutError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/StatementTimeoutError")("StatementTimeoutError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return true;
  }
}

class UnknownError2 extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError/UnknownError")("UnknownError", ReasonFields)) {
  [ReasonTypeId] = ReasonTypeId;
  get isRetryable() {
    return false;
  }
}
var SqlErrorReason = /* @__PURE__ */ Union2([ConnectionError, AuthenticationError, AuthorizationError, SqlSyntaxError, UniqueViolation, ConstraintError, DeadlockError, SerializationError, LockTimeoutError, StatementTimeoutError, UnknownError2]);

class SqlError extends (/* @__PURE__ */ TaggedError3("effect/sql/SqlError")("SqlError", {
  reason: SqlErrorReason
})) {
  [TypeId26] = TypeId26;
  cause = this.reason;
  get message() {
    return this.reason.message || this.reason._tag;
  }
  get isRetryable() {
    return this.reason.isRetryable;
  }
}

// ../../node_modules/effect/dist/sql/Statement.js
var FragmentTypeId = /* @__PURE__ */ Symbol.for("~effect/sql/Statement/Fragment");
var SegmentTypeId = /* @__PURE__ */ Symbol.for("~effect/sql/Statement/Segment");
var fragment = (segments) => ({
  [FragmentTypeId]: FragmentTypeId,
  segments
});
var CurrentTransformer = /* @__PURE__ */ Reference("effect/sql/CurrentTransformer", {
  defaultValue: constUndefined
});
var SpanPropagationEnabled = /* @__PURE__ */ Reference("effect/sql/SpanPropagationEnabled", {
  defaultValue: () => false
});
var isFragment = (u) => hasProperty(u, FragmentTypeId);
var literal = (value, params) => ({
  [SegmentTypeId]: SegmentTypeId,
  _tag: "Literal",
  value,
  params
});
var identifier2 = (value) => ({
  [SegmentTypeId]: SegmentTypeId,
  _tag: "Identifier",
  value
});
var parameter = (value) => ({
  [SegmentTypeId]: SegmentTypeId,
  _tag: "Parameter",
  value
});
var arrayHelper = (value) => ({
  [SegmentTypeId]: SegmentTypeId,
  _tag: "ArrayHelper",
  value
});
var RecordInsertHelperProto = {
  [SegmentTypeId]: SegmentTypeId,
  _tag: "RecordInsertHelper",
  returning(sql) {
    const self = Object.create(Object.getPrototypeOf(this));
    Object.assign(self, this, {
      returningIdentifier: typeof sql === "string" || isFragment(sql) ? sql : fragment([sql])
    });
    return self;
  }
};
var recordInsertHelper = (value) => Object.assign(Object.create(RecordInsertHelperProto), {
  value,
  returningIdentifier: undefined
});
var RecordUpdateHelperProto = {
  ...RecordInsertHelperProto,
  _tag: "RecordUpdateHelper"
};
var recordUpdateHelper = (value, alias) => Object.assign(Object.create(RecordUpdateHelperProto), {
  value,
  alias,
  returningIdentifier: undefined
});
var RecordUpdateHelperSingleProto = {
  ...RecordInsertHelperProto,
  _tag: "RecordUpdateHelperSingle"
};
var recordUpdateHelperSingle = (value, omit) => Object.assign(Object.create(RecordUpdateHelperSingleProto), {
  value,
  omit,
  returningIdentifier: undefined
});
var custom = (kind) => (paramA, paramB, paramC) => ({
  [SegmentTypeId]: SegmentTypeId,
  _tag: "Custom",
  kind,
  paramA,
  paramB,
  paramC
});
var make19 = (acquirer, compiler, spanAttributes, transformRows, borrower) => {
  const self = Object.assign(function sql(strings, ...args) {
    if (typeof strings === "string") {
      return identifier2(strings);
    } else if (Array.isArray(strings) && "raw" in strings) {
      return makeUnsafe7(templateSegments(strings, args), acquirer, compiler, spanAttributes, transformRows, borrower, self);
    }
    throw "absurd";
  }, {
    unsafe(sql, params) {
      return makeUnsafe7([literal(sql, params)], acquirer, compiler, spanAttributes, transformRows, borrower, self);
    },
    literal(sql) {
      return fragment([literal(sql)]);
    },
    in: in_,
    insert(value) {
      return recordInsertHelper(Array.isArray(value) ? value : [value]);
    },
    update(value, omit) {
      return recordUpdateHelperSingle(value, omit ?? []);
    },
    updateValues(value, alias) {
      return recordUpdateHelper(value, alias);
    },
    and,
    or,
    csv,
    join: join2,
    onDialect(options) {
      return options[compiler.dialect]();
    },
    onDialectOrElse(options) {
      return options[compiler.dialect] !== undefined ? options[compiler.dialect]() : options.orElse();
    }
  });
  return self;
};
var templateSegments = (strings, args) => {
  const segments = strings[0].length > 0 ? [literal(strings[0])] : [];
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (isFragment(arg)) {
      segments.push(...arg.segments);
    } else if (isSegment(arg)) {
      segments.push(arg);
    } else {
      segments.push(parameter(arg));
    }
    if (strings[i + 1].length > 0) {
      segments.push(literal(strings[i + 1]));
    }
  }
  return segments;
};
function join2(lit, addParens = true, fallback = "") {
  const literalStatement = literal(lit);
  const fallbackFragment = fragment([literal(fallback)]);
  return (clauses) => {
    if (clauses.length === 0) {
      return fallbackFragment;
    } else if (clauses.length === 1) {
      return fragment(convertLiteralOrFragment(clauses[0]));
    }
    const segments = [];
    if (addParens) {
      segments.push(literal("("));
    }
    segments.push.apply(segments, convertLiteralOrFragment(clauses[0]));
    for (let i = 1;i < clauses.length; i++) {
      segments.push(literalStatement);
      segments.push.apply(segments, convertLiteralOrFragment(clauses[i]));
    }
    if (addParens) {
      segments.push(literal(")"));
    }
    return fragment(segments);
  };
}
var and = /* @__PURE__ */ join2(" AND ", true, "1=1");
var or = /* @__PURE__ */ join2(" OR ", true, "1=1");
var csv = function(...args) {
  if (args[args.length - 1].length === 0) {
    return emptyFragment;
  }
  if (args.length === 1) {
    return csvRaw(args[0]);
  }
  return fragment([literal(`${args[0]} `), ...csvRaw(args[1]).segments]);
};
var csvRaw = /* @__PURE__ */ join2(",", false);
var emptyFragment = /* @__PURE__ */ fragment([/* @__PURE__ */ literal("")]);
var makeCompiler = (options) => {
  const self = Object.create(CompilerProto);
  self.options = options;
  self.dialect = options.dialect;
  self.disableTransforms = false;
  self.statementCache = new WeakMap;
  self.statementCacheNoTransform = new WeakMap;
  return self;
};
var CompilerProto = {
  compile(statement, withoutTransform = false, placeholderOverride) {
    const opts = this.options;
    withoutTransform = withoutTransform || this.disableTransforms;
    const cache = withoutTransform ? this.statementCacheNoTransform : this.statementCache;
    const cached = cache.get(statement);
    if (cached !== undefined && placeholderOverride === undefined) {
      return cached;
    }
    const segments = statement.segments;
    const len = segments.length;
    let sql = "";
    const binds = [];
    let placeholderCount = 0;
    const placeholder = placeholderOverride ?? ((u) => opts.placeholder(++placeholderCount, u));
    const placeholderNoIncrement = (u) => opts.placeholder(placeholderCount, u);
    const placeholders = makePlaceholdersArray(placeholder);
    for (let i = 0;i < len; i++) {
      const segment = segments[i];
      switch (segment._tag) {
        case "Literal": {
          sql += segment.value;
          if (segment.params) {
            binds.push.apply(binds, segment.params);
          }
          break;
        }
        case "Identifier": {
          sql += opts.onIdentifier(segment.value, withoutTransform);
          break;
        }
        case "Parameter": {
          sql += placeholder(segment.value);
          binds.push(segment.value);
          break;
        }
        case "ArrayHelper": {
          if (segment.value.length === 0) {
            const inKeyword = emptyInKeyword.exec(sql);
            if (inKeyword === null || isInLineComment(sql, inKeyword.index)) {
              sql += "()";
            } else if (this.dialect === "pg") {
              sql = sql.slice(0, inKeyword.index) + (inKeyword[1] ? "<> ALL('{}')" : "= ANY('{}')");
            } else {
              sql += "(SELECT NULL WHERE 1=0)";
            }
            break;
          }
          sql += `(${placeholders(segment.value)})`;
          binds.push.apply(binds, segment.value);
          break;
        }
        case "RecordInsertHelper": {
          const keys = Object.keys(segment.value[0]);
          if (opts.onInsert) {
            const values = new Array(segment.value.length);
            let placeholders = "";
            for (let i = 0;i < segment.value.length; i++) {
              const row = new Array(keys.length);
              values[i] = row;
              placeholders += i === 0 ? "(" : ",(";
              for (let j = 0;j < keys.length; j++) {
                const key = keys[j];
                const value = segment.value[i][key];
                const primitive = extractPrimitive(value, opts.onCustom, placeholderNoIncrement, withoutTransform);
                row[j] = primitive;
                placeholders += j === 0 ? placeholder(value) : `,${placeholder(value)}`;
              }
              placeholders += ")";
            }
            const [s, b] = opts.onInsert(keys.map((_) => opts.onIdentifier(_, withoutTransform)), placeholders, values, typeof segment.returningIdentifier === "string" ? [segment.returningIdentifier, []] : segment.returningIdentifier ? this.compile(segment.returningIdentifier, withoutTransform, placeholder) : undefined);
            sql += s;
            binds.push.apply(binds, b);
          } else {
            let placeholders = "";
            for (let i = 0;i < segment.value.length; i++) {
              placeholders += i === 0 ? "(" : ",(";
              for (let j = 0;j < keys.length; j++) {
                const value = segment.value[i][keys[j]];
                const primitive = extractPrimitive(value, opts.onCustom, placeholderNoIncrement, withoutTransform);
                binds.push(primitive);
                placeholders += j === 0 ? placeholder(value) : `,${placeholder(value)}`;
              }
              placeholders += ")";
            }
            sql += `${generateColumns(keys, opts.onIdentifier, withoutTransform)} VALUES ${placeholders}`;
            if (typeof segment.returningIdentifier === "string") {
              sql += ` RETURNING ${segment.returningIdentifier}`;
            } else if (segment.returningIdentifier) {
              sql += " RETURNING ";
              const [s, b] = this.compile(segment.returningIdentifier, withoutTransform, placeholder);
              sql += s;
              binds.push.apply(binds, b);
            }
          }
          break;
        }
        case "RecordUpdateHelperSingle": {
          let keys = Object.keys(segment.value);
          if (segment.omit.length > 0) {
            keys = keys.filter((key) => !segment.omit.includes(key));
          }
          if (opts.onRecordUpdateSingle) {
            const [s, b] = opts.onRecordUpdateSingle(keys.map((_) => opts.onIdentifier(_, withoutTransform)), keys.map((key) => extractPrimitive(segment.value[key], opts.onCustom, placeholderNoIncrement, withoutTransform)), typeof segment.returningIdentifier === "string" ? [segment.returningIdentifier, []] : segment.returningIdentifier ? this.compile(segment.returningIdentifier, withoutTransform, placeholder) : undefined);
            sql += s;
            binds.push.apply(binds, b);
          } else {
            for (let i = 0, len = keys.length;i < len; i++) {
              const column = opts.onIdentifier(keys[i], withoutTransform);
              if (i === 0) {
                sql += `${column} = ${placeholder(segment.value[keys[i]])}`;
              } else {
                sql += `, ${column} = ${placeholder(segment.value[keys[i]])}`;
              }
              binds.push(extractPrimitive(segment.value[keys[i]], opts.onCustom, placeholderNoIncrement, withoutTransform));
            }
            if (typeof segment.returningIdentifier === "string") {
              if (this.dialect === "mssql") {
                sql += ` OUTPUT ${segment.returningIdentifier === "*" ? "INSERTED.*" : segment.returningIdentifier}`;
              } else {
                sql += ` RETURNING ${segment.returningIdentifier}`;
              }
            } else if (segment.returningIdentifier) {
              sql += this.dialect === "mssql" ? " OUTPUT " : " RETURNING ";
              const [s, b] = this.compile(segment.returningIdentifier, withoutTransform, placeholder);
              sql += s;
              binds.push.apply(binds, b);
            }
          }
          break;
        }
        case "RecordUpdateHelper": {
          const keys = Object.keys(segment.value[0]);
          const values = new Array(segment.value.length);
          let placeholders = "";
          for (let i = 0;i < segment.value.length; i++) {
            const row = new Array(keys.length);
            values[i] = row;
            placeholders += i === 0 ? "(" : ",(";
            for (let j = 0;j < keys.length; j++) {
              const key = keys[j];
              const value = segment.value[i][key];
              row[j] = extractPrimitive(value, opts.onCustom, placeholderNoIncrement, withoutTransform);
              placeholders += j === 0 ? placeholder(value) : `,${placeholder(value)}`;
            }
            placeholders += ")";
          }
          const [s, b] = opts.onRecordUpdate(placeholders, opts.onIdentifier(segment.alias, true), generateColumns(keys, opts.onIdentifier, withoutTransform), values, typeof segment.returningIdentifier === "string" ? [segment.returningIdentifier, []] : segment.returningIdentifier ? this.compile(segment.returningIdentifier, withoutTransform, placeholder) : undefined);
          sql += s;
          binds.push.apply(binds, b);
          break;
        }
        case "Custom": {
          const [s, b] = opts.onCustom(segment, placeholder, withoutTransform);
          sql += s;
          binds.push.apply(binds, b);
          break;
        }
      }
    }
    const result = [sql, binds];
    if (placeholderOverride !== undefined) {
      return result;
    }
    cache.set(statement, result);
    return result;
  },
  get withoutTransform() {
    const self = Object.create(CompilerProto);
    Object.assign(self, this, {
      disableTransforms: true
    });
    return self;
  }
};
function defaultEscape(c) {
  const re = new RegExp(c, "g");
  const double = c + c;
  const dot = c + "." + c;
  return function(str) {
    return c + str.replace(re, double).replace(/\./g, dot) + c;
  };
}
var defaultTransforms = (transformer, nested = true) => {
  const transformValue = (value) => {
    if (Array.isArray(value)) {
      if (value.length === 0 || value[0]?.constructor !== Object) {
        return value;
      }
      return array(value);
    } else if (value?.constructor === Object) {
      return transformObject(value);
    }
    return value;
  };
  const transformObject = (obj) => {
    const newObj = {};
    for (const key of Object.keys(obj)) {
      assignProperty(newObj, transformer(key), transformValue(obj[key]));
    }
    return newObj;
  };
  const transformArrayNested = (rows) => {
    const newRows = new Array(rows.length);
    for (let i = 0, len = rows.length;i < len; i++) {
      const row = rows[i];
      if (Array.isArray(row)) {
        newRows[i] = transformArrayNested(row);
      } else if (row === null || typeof row !== "object") {
        newRows[i] = row;
      } else {
        const obj = {};
        for (const [key, value] of Object.entries(row)) {
          assignProperty(obj, transformer(key), transformValue(value));
        }
        newRows[i] = obj;
      }
    }
    return newRows;
  };
  const transformArray = (rows) => {
    const newRows = new Array(rows.length);
    for (let i = 0, len = rows.length;i < len; i++) {
      const row = rows[i];
      if (Array.isArray(row)) {
        newRows[i] = transformArray(row);
      } else if (row === null || typeof row !== "object") {
        newRows[i] = row;
      } else {
        const obj = {};
        for (const [key, value] of Object.entries(row)) {
          assignProperty(obj, transformer(key), value);
        }
        newRows[i] = obj;
      }
    }
    return newRows;
  };
  const array = nested ? transformArrayNested : transformArray;
  return {
    value: transformValue,
    object: transformObject,
    array
  };
};
var spanTarget = (spanAttributes) => {
  const namespace = spanAttribute(spanAttributes, "db.namespace");
  if (isNonEmptyString(namespace)) {
    return namespace;
  }
  const address = spanAttribute(spanAttributes, "server.address");
  if (isNonEmptyString(address)) {
    const port = spanAttribute(spanAttributes, "server.port");
    return port === undefined ? address : `${address}:${port}`;
  }
  return;
};
var spanName = (spanAttributes) => {
  const target = spanTarget(spanAttributes);
  if (target !== undefined) {
    return target;
  }
  const system = spanAttribute(spanAttributes, "db.system.name");
  return isNonEmptyString(system) ? system : "sql.execute";
};
var ATTR_DB_QUERY_TEXT = "db.query.text";
var ATTR_SQL_METHOD = "effect.sql.method";
var spanAttribute = (spanAttributes, key) => {
  for (let i = spanAttributes.length - 1;i >= 0; i--) {
    if (spanAttributes[i][0] === key) {
      return spanAttributes[i][1];
    }
  }
  return;
};
var isNonEmptyString = (u) => typeof u === "string" && u.length > 0;
var makeUnsafe7 = (segments, acquirer, compiler, spanAttributes, transformRows, borrower, sql) => {
  const self = Object.create(StatementProto);
  self.segments = segments;
  self.acquirer = acquirer;
  self.compiler = compiler;
  self.spanAttributes = spanAttributes;
  self.transformRows = transformRows;
  self.borrower = borrower;
  self.sql = sql;
  return self;
};
var StatementProto = {
  [FragmentTypeId]: FragmentTypeId,
  withConnection(operation, f, withoutTransform = false) {
    return useSpan2(spanName(this.spanAttributes), {
      kind: "client"
    }, (span) => this.withConnectionSpan(operation, f, withoutTransform, span));
  },
  withConnectionSpan(operation, f, withoutTransform, span) {
    return withStatement(this, span, (statement, fiber) => {
      const [sql, params] = statement.compile(withoutTransform);
      for (const [key, value] of this.spanAttributes) {
        span.attribute(key, value);
      }
      span.attribute(ATTR_SQL_METHOD, operation);
      span.attribute(ATTR_DB_QUERY_TEXT, sql);
      const propagate = fiber.cache.tracerEnabled && fiber.getRef(SpanPropagationEnabled);
      const clock = propagate ? waitClock(fiber) : undefined;
      const run = clock === undefined ? (connection) => f(connection, sql, params) : (connection) => suspend2(() => {
        recordConnectionWait(span, clock);
        return f(connection, sql, params);
      });
      const execute = this.borrower === undefined ? scoped2(flatMap3(this.acquirer, run)) : this.borrower(run);
      return propagate ? provideService2(execute, ParentSpan, span) : execute;
    });
  },
  get withoutTransform() {
    return this.withConnection("executeWithoutTransform", (connection, sql, params) => connection.execute(sql, params, undefined), true);
  },
  get raw() {
    return this.withConnection("executeRaw", (connection, sql, params) => connection.executeRaw(sql, params), true);
  },
  get stream() {
    const self = this;
    return unwrap2(flatMap3(makeSpanScoped2(spanName(self.spanAttributes), {
      kind: "client"
    }), (span) => withStatement(self, span, (statement, fiber) => {
      const [sql, params] = statement.compile();
      for (const [key, value] of self.spanAttributes) {
        span.attribute(key, value);
      }
      span.attribute(ATTR_SQL_METHOD, "executeStream");
      span.attribute(ATTR_DB_QUERY_TEXT, sql);
      const propagate = fiber.cache.tracerEnabled && fiber.getRef(SpanPropagationEnabled);
      const clock = propagate ? waitClock(fiber) : undefined;
      const acquire = map6(self.acquirer, (connection) => {
        if (clock !== undefined)
          recordConnectionWait(span, clock);
        return connection.executeStream(sql, params, self.transformRows);
      });
      return propagate ? succeed6(provideService4(unwrap2(acquire), ParentSpan, span)) : acquire;
    })));
  },
  get values() {
    return this.withConnection("executeValues", (connection, sql, params) => connection.executeValues(sql, params));
  },
  get valuesUnprepared() {
    return this.withConnection("executeValuesUnprepared", (connection, sql, params) => connection.executeValuesUnprepared(sql, params));
  },
  get unprepared() {
    const self = this;
    return self.withConnection("executeUnprepared", (connection, sql, params) => connection.executeUnprepared(sql, params, self.transformRows));
  },
  .../* @__PURE__ */ Prototype2({
    label: "Statement",
    evaluate(fiber) {
      const span = makeSpanUnsafe(fiber, spanName(this.spanAttributes), {
        kind: "client"
      });
      const clock = fiber.getRef(Clock);
      const timingEnabled = fiber.getRef(TracerTimingEnabled2);
      return onExit2(this.withConnectionSpan("execute", (connection, sql, params) => connection.execute(sql, params, this.transformRows), false, span), (exit) => endSpan(span, exit, clock, timingEnabled));
    }
  }),
  compile(withoutTransform) {
    return this.compiler.compile(this, withoutTransform ?? false);
  },
  toJSON() {
    const [sql, params] = this.compile();
    return {
      _id: "Statement",
      segments: this.segments,
      sql,
      params
    };
  }
};
var withStatement = (self, span, f) => withFiber2((fiber) => {
  const transform = fiber.getRef(CurrentTransformer);
  if (transform === undefined) {
    return f(self, fiber);
  }
  return flatMap3(transform(self, self.sql ?? make19(self.acquirer, self.compiler, self.spanAttributes, self.transformRows, self.borrower), fiber, span), (statement) => f(statement, fiber));
});
var isSegment = (u) => hasProperty(u, SegmentTypeId);
function convertLiteralOrFragment(clause) {
  if (typeof clause === "string") {
    return [literal(clause)];
  }
  return clause.segments;
}
var makePlaceholdersArray = (evaluate) => (values) => {
  if (values.length === 0) {
    return "";
  }
  let result = evaluate(values[0]);
  for (let i = 1;i < values.length; i++) {
    result += `,${evaluate(values[i])}`;
  }
  return result;
};
var generateColumns = (keys, escape, withoutTransform) => {
  if (keys.length === 0) {
    return "()";
  }
  let str = `(${escape(keys[0], withoutTransform)}`;
  for (let i = 1;i < keys.length; i++) {
    str += `,${escape(keys[i], withoutTransform)}`;
  }
  return str + ")";
};
var extractPrimitive = (value, onCustom, placeholder, withoutTransform) => {
  if (value === undefined) {
    return null;
  } else if (isFragment(value)) {
    const head = value.segments[0];
    if (head._tag === "Custom") {
      const compiled = onCustom(head, placeholder, withoutTransform);
      return compiled[1][0] ?? null;
    } else if (head._tag === "Parameter") {
      return head.value;
    }
    return null;
  }
  return value;
};
function in_() {
  if (arguments.length === 1) {
    return arrayHelper(arguments[0]);
  }
  const column = arguments[0];
  const values = arguments[1];
  return values.length === 0 ? neverFragment : fragment([identifier2(column), literal(" IN "), arrayHelper(values)]);
}
var neverFragment = /* @__PURE__ */ fragment([/* @__PURE__ */ literal("1=0")]);
var emptyInKeyword = /\b(NOT\s+)?IN\s*$/i;
var isInLineComment = (sql, index) => sql.lastIndexOf("--", index) > sql.lastIndexOf(`
`, index);

// ../../node_modules/effect/dist/sql/SqlClient.js
var TypeId27 = "~effect/sql/SqlClient";
var SqlClient = /* @__PURE__ */ Service("effect/sql/SqlClient");
var clientIdCounter = 0;
var transactionSemaphoreIdCounter = 0;
var ATTR_DB_OPERATION_NAME = "db.operation.name";
var make20 = /* @__PURE__ */ fnUntraced2(function* (options) {
  const transactionService = options.transactionService ?? TransactionConnection(clientIdCounter++);
  const getConnection = flatMap3(serviceOption2(transactionService), match({
    onNone: () => options.acquirer,
    onSome: activeTransactionConnection
  }));
  const beginTransaction = options.beginTransaction ?? "BEGIN";
  const commit = options.commit ?? "COMMIT";
  const savepoint = options.savepoint ?? ((name) => `SAVEPOINT ${name}`);
  const releaseSavepoint = options.releaseSavepoint;
  const rollback = options.rollback ?? "ROLLBACK";
  const rollbackSavepoint = options.rollbackSavepoint ?? ((name) => `ROLLBACK TO SAVEPOINT ${name}`);
  const transactionAcquirer = options.transactionAcquirer ?? options.acquirer;
  const unprepared = (conn, sql) => conn.executeUnprepared(sql, [], undefined);
  const control = options.prepareTransactionControls === true ? (conn, sql) => conn.execute(sql, [], undefined) : unprepared;
  const isTransaction = options.isTransaction;
  const cleanup = isTransaction ? (conn, sql) => isTransaction(conn) ? unprepared(conn, sql) : void_4 : unprepared;
  const withTransaction = makeWithTransaction({
    transactionService,
    spanAttributes: options.spanAttributes,
    acquireConnection: (restore) => restore(transactionAcquirer),
    begin: options.begin ?? ((conn, statement) => statement === undefined ? control(conn, beginTransaction) : unprepared(conn, statement)),
    savepoint: (conn, id) => control(conn, savepoint(`effect_sql_${id}`)),
    releaseSavepoint: releaseSavepoint ? (conn, id) => cleanup(conn, releaseSavepoint(`effect_sql_${id}`)) : undefined,
    commit: typeof commit === "string" ? (conn) => control(conn, commit) : commit,
    onCommitFailure: options.onCommitFailure,
    rollback: (conn) => cleanup(conn, rollback),
    rollbackSavepoint: (conn, id) => cleanup(conn, rollbackSavepoint(`effect_sql_${id}`))
  });
  const afterCommit = makeAfterCommit(transactionService);
  const reactivity = yield* Reactivity;
  const borrower = options.borrower === undefined ? undefined : (f) => flatMap3(serviceOption2(transactionService), match({
    onNone: () => options.borrower(f),
    onSome: (transaction) => flatMap3(activeTransactionConnection(transaction), f)
  }));
  const client = Object.assign(make19(getConnection, options.compiler, options.spanAttributes, options.transformRows, borrower), {
    [TypeId27]: TypeId27,
    safe: undefined,
    withTransaction,
    transactionService,
    afterCommit,
    reserve: transactionAcquirer,
    driver: options.driver,
    withoutTransforms() {
      const statement = make19(getConnection, options.compiler.withoutTransform, options.spanAttributes, undefined, borrower);
      const client = Object.assign(statement, {
        ...this,
        ...statement
      });
      client.safe = client;
      client.withoutTransforms = () => client;
      return client;
    },
    reactive: options.reactiveQueue ? (keys, effect) => options.reactiveQueue(keys, effect).pipe(map6(fromQueue), unwrap2) : reactivity.stream,
    reactiveMailbox: options.reactiveQueue ?? reactivity.query
  });
  client.safe = client;
  return client;
});
var failuresToDefects = (cause) => fromReasons(cause.reasons.map((reason) => isFailReason2(reason) ? makeDieReason(reason.error).annotate(reasonAnnotations2(reason)) : reason));
var afterCommitBuffers = /* @__PURE__ */ new WeakMap;
var hasEnded = (buffer) => {
  for (;buffer !== undefined; buffer = buffer.parent) {
    if (!buffer.open) {
      return true;
    }
  }
  return false;
};
var transactionEnded = /* @__PURE__ */ suspend2(() => fail6(new SqlError({
  reason: new UnknownError2({
    cause: undefined,
    message: "SqlClient: the transaction has already ended"
  })
})));
var activeTransactionConnection = (transaction) => hasEnded(afterCommitBuffers.get(transaction)) ? transactionEnded : succeed6(transaction[0]);
var runAfterCommit = (effect) => ignoreCause2(effect, {
  log: "Unhandled",
  message: "Unhandled error in SqlClient.afterCommit callback"
});
var makeAfterCommit = (transactionService) => (effect) => withFiber2((fiber) => {
  const transaction = getOrUndefined2(fiber.context, transactionService);
  const buffer = transaction && afterCommitBuffers.get(transaction);
  if (buffer === undefined) {
    return runAfterCommit(effect);
  }
  if (hasEnded(buffer)) {
    return die3(new Error("SqlClient.afterCommit: the transaction has already ended"));
  }
  buffer.callbacks.push(provideContext2(effect, omit(transactionService)(fiber.context)));
  return void_4;
});
var makeWithTransaction = (options) => {
  const transactionSemaphore = Service(`effect/sql/SqlClient/TransactionSemaphore/${transactionSemaphoreIdCounter++}`);
  const afterCommit = makeAfterCommit(options.transactionService);
  const target = spanTarget(options.spanAttributes);
  const deferInvalidations = (reactivity) => {
    const invalidate = (keys) => afterCommit(sync2(() => reactivity.invalidateUnsafe(keys)));
    return {
      ...reactivity,
      invalidate,
      mutation: (keys, effect) => tap2(effect, invalidate(keys))
    };
  };
  return (effect) => uninterruptibleMask2((restore) => useSpan2("sql.transaction", {
    kind: "internal"
  }, (span) => withFiber2((fiber) => {
    for (const [key, value] of options.spanAttributes) {
      span.attribute(key, value);
    }
    const services = fiber.context;
    const reactivity = getOrUndefined2(services, Reactivity);
    const propagate = fiber.cache.tracerEnabled && fiber.getRef(SpanPropagationEnabled);
    const waitedClock = propagate ? waitClock(fiber) : undefined;
    const control = (operation, effect) => useSpan2(target === undefined ? operation : `${operation} ${target}`, {
      kind: "client",
      parent: span
    }, (controlSpan) => {
      for (const [key, value] of options.spanAttributes) {
        controlSpan.attribute(key, value);
      }
      controlSpan.attribute(ATTR_DB_OPERATION_NAME, operation);
      return effect;
    });
    const connOption = getOption(services, options.transactionService);
    const conn = connOption._tag === "Some" ? map6(suspend2(() => activeTransactionConnection(connOption.value)), (conn) => [undefined, conn]) : flatMap3(make6(), (scope) => provide(options.acquireConnection(restore), scope).pipe(provideService2(ParentSpan, span), map6((conn) => {
      if (waitedClock !== undefined)
        recordConnectionWait(span, waitedClock);
      return [scope, conn];
    }), onError2((cause) => close(scope, failCause2(cause)))));
    const id = connOption._tag === "Some" ? connOption.value[1] + 1 : 0;
    const buffer = {
      callbacks: [],
      parent: connOption._tag === "Some" ? afterCommitBuffers.get(connOption.value) : undefined,
      open: true
    };
    let committed = false;
    const start = (conn) => id === 0 ? control("BEGIN", options.begin(conn, fiber.getRef(BeginTransaction))) : control("SAVEPOINT", options.savepoint(conn, id));
    const transaction = flatMap3(conn, ([scope, conn]) => start(conn).pipe(flatMap3(() => {
      const level = [conn, id];
      afterCommitBuffers.set(level, buffer);
      return onExitPrimitive2(provideContext2(restore(effect), services.pipe(add(options.transactionService, level), add(CurrentTransactionService, options.transactionService), reactivity ? add(Reactivity, deferInvalidations(reactivity)) : identity, add(transactionSemaphore, makeUnsafe5(1)), add(ParentSpan, span))), (exit) => {
        buffer.open = false;
        if (hasEnded(buffer.parent)) {
          return isSuccess3(exit) ? transactionEnded : exit;
        }
        let effect;
        if (isSuccess3(exit)) {
          if (id === 0) {
            const onCommitFailure = options.onCommitFailure;
            const commit = control("COMMIT", options.commit(conn));
            effect = onCommitFailure ? catchCause2(commit, (commitCause) => matchCauseEffect2(control("ROLLBACK", onCommitFailure(conn)), {
              onFailure: (cleanupCause) => failCause3(failuresToDefects(combine2(commitCause, cleanupCause))),
              onSuccess: () => failCause3(commitCause)
            })) : commit;
          } else {
            effect = void_4;
          }
        } else {
          effect = orDie2(id > 0 ? control("ROLLBACK TO SAVEPOINT", options.rollbackSavepoint(conn, id)) : control("ROLLBACK", options.rollback(conn)));
        }
        if (id > 0 && options.releaseSavepoint) {
          const release = orDie2(control("RELEASE SAVEPOINT", options.releaseSavepoint(conn, id)));
          effect = flatMap3(effect, () => hasEnded(buffer.parent) ? void_4 : release);
        }
        return flatMap3(effect, () => {
          committed = isSuccess3(exit);
          return exit;
        });
      }, true);
    }), scope ? (eff) => onExitPrimitive2(eff, (exit) => close(scope, exit), true) : identity));
    const settled = onExitPrimitive2(transaction, () => {
      if (!committed || buffer.callbacks.length === 0) {
        return;
      }
      if (buffer.parent !== undefined) {
        buffer.parent.callbacks.push(...buffer.callbacks);
        return;
      }
      return forEach2(buffer.callbacks, runAfterCommit, {
        discard: true
      });
    }, true);
    return id === 0 ? settled : restore(getUnsafe(services, transactionSemaphore).withPermit(uninterruptible2(settled)));
  })));
};
var TransactionConnection = (clientId) => Service(`effect/sql/SqlClient/TransactionConnection/${clientId}`);
var BeginTransaction = /* @__PURE__ */ Reference("effect/sql/SqlClient/BeginTransaction", {
  defaultValue: () => {
    return;
  }
});

// ../../node_modules/@effect/sql-pg/dist/internal/config.js
var configError = (message, cause) => new SqlError({
  reason: new ConnectionError({
    cause: cause ?? new Error(message),
    message: `PgConnection: ${message}`,
    operation: "connect"
  })
});
var keepAliveMillis = (input) => {
  const duration = fromInput(input);
  if (isNone2(duration))
    return;
  const seconds = Math.floor(toSeconds(duration.value));
  return seconds >= 1 && seconds <= 2147483647 ? seconds * 1000 : undefined;
};
var resolveConfig = (options) => suspend2(() => {
  const parsed = options.url !== undefined ? parseUrl(value2(options.url)) : succeed2({});
  if (isFailure2(parsed))
    return fail6(parsed.failure);
  const url = parsed.success;
  const host = options.host ?? url.host ?? "localhost";
  const port = options.port ?? url.port ?? 5432;
  const username = options.username ?? url.username ?? process.env.USER ?? process.env.USERNAME;
  if (username === undefined) {
    return fail6(configError("No username configured"));
  }
  const keepAlive = options.keepAlive === undefined ? undefined : keepAliveMillis(options.keepAlive);
  if (options.keepAlive !== undefined && keepAlive === undefined) {
    return fail6(configError("keepAlive must be between 1 and 2147483647 seconds"));
  }
  const named = Object.create(null);
  for (const [name, value] of Object.entries(options.startupParameters ?? {})) {
    const key = name.toLowerCase();
    if (key === "user" || key === "database" || key === "replication" || key === "options") {
      return fail6(configError(`Reserved startup parameter: "${name}"`));
    }
    if (key === "client_encoding") {
      const encoding = value.toUpperCase();
      if (encoding !== "UTF8" && encoding !== "UTF-8") {
        return fail6(configError("Startup parameter client_encoding must be UTF8 or UTF-8"));
      }
      named[key] = "UTF8";
    } else {
      named[key] = value;
    }
    if (name === "" || name.includes("\x00") || value.includes("\x00")) {
      return fail6(configError("Startup parameter names must be nonempty and names/values must not contain NUL"));
    }
  }
  const startupParameters = {
    ...named,
    user: username,
    database: options.database ?? url.database,
    application_name: options.applicationName ?? named.application_name ?? url.applicationName ?? "@effect/sql-pg",
    options: options.startupOptions ?? url.options
  };
  for (const [name, value] of Object.entries(startupParameters)) {
    if (value?.includes("\x00")) {
      return fail6(configError(`Startup parameter "${name}" must not contain NUL`));
    }
  }
  return succeed6({
    host,
    port,
    path: options.path ?? (host.startsWith("/") ? `${host}/.s.PGSQL.${port}` : undefined),
    ssl: options.ssl ?? (url.ssl === "prefer" ? true : url.ssl ?? false),
    sslOptional: options.ssl === undefined && url.ssl === "prefer",
    username,
    password: options.password ?? (url.password !== undefined ? make10(url.password) : undefined),
    connectTimeout: fromInputUnsafe(options.connectTimeout ?? url.connectTimeout ?? seconds(5)),
    keepAlive,
    startupParameters,
    stream: options.stream,
    maxMessageSize: options.maxMessageSize
  });
});
var decodeComponent = (value, what) => {
  try {
    return succeed2(decodeURIComponent(value));
  } catch {
    return fail2(configError(`Invalid percent-encoding in URL ${what}`));
  }
};
var parsePort = (value, what) => {
  const port = Number(value);
  return !Number.isInteger(port) || port < 1 || port > 65535 ? fail2(configError(`Invalid port in URL ${what}: "${value}"`)) : succeed2(port);
};
var parseUrl = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    return fail2(configError("Invalid connection URL", cause));
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return fail2(configError(`Unsupported connection URL protocol: "${url.protocol}"`));
  }
  const config = {};
  if (url.hostname !== "") {
    if (url.hostname.startsWith("[") && url.hostname.endsWith("]")) {
      config.host = url.hostname.slice(1, -1);
    } else {
      const host = decodeComponent(url.hostname, "host");
      if (isFailure2(host))
        return fail2(host.failure);
      config.host = host.success;
    }
  }
  if (url.port !== "") {
    const port = parsePort(url.port, "authority");
    if (isFailure2(port))
      return fail2(port.failure);
    config.port = port.success;
  }
  if (url.username !== "") {
    const username = decodeComponent(url.username, "username");
    if (isFailure2(username))
      return fail2(username.failure);
    config.username = username.success;
  }
  if (url.password !== "") {
    const password = decodeComponent(url.password, "password");
    if (isFailure2(password))
      return fail2(password.failure);
    config.password = password.success;
  }
  const database = decodeComponent(url.pathname.replace(/^\//, ""), "database");
  if (isFailure2(database))
    return fail2(database.failure);
  if (database.success !== "")
    config.database = database.success;
  for (const [key, value] of url.searchParams) {
    switch (key) {
      case "host":
        config.host = value;
        break;
      case "port": {
        const port = parsePort(value, "port parameter");
        if (isFailure2(port))
          return fail2(port.failure);
        config.port = port.success;
        break;
      }
      case "user":
        config.username = value;
        break;
      case "password":
        config.password = value;
        break;
      case "dbname":
        config.database = value;
        break;
      case "application_name":
        config.applicationName = value;
        break;
      case "options":
        config.options = value;
        break;
      case "connect_timeout": {
        const seconds2 = Number(value);
        if (!Number.isInteger(seconds2) || seconds2 < 0) {
          return fail2(configError(`Invalid connect_timeout in URL: "${value}"`));
        }
        config.connectTimeout = seconds2 === 0 ? infinity : seconds(seconds2);
        break;
      }
      case "sslmode":
        switch (value) {
          case "disable":
            config.ssl = false;
            break;
          case "require":
          case "verify-ca":
          case "verify-full":
            config.ssl = true;
            break;
          case "prefer":
          case "allow":
            config.ssl = "prefer";
            break;
          default:
            return fail2(configError(`Unrecognized sslmode in URL: "${value}"`));
        }
        break;
    }
  }
  return succeed2(config);
};

// ../../node_modules/@effect/sql-pg/dist/internal/connection.js
var internalsKey = "~@effect/sql-pg/PgConnection/internals";
var connectionInternals = (connection) => connection[internalsKey];

// ../../node_modules/@effect/sql-pg/dist/internal/sqlError.js
var channelNameEncoder = /* @__PURE__ */ new TextEncoder;
var validateChannelName = (channel, operation) => {
  if (channelNameEncoder.encode(channel).byteLength <= 63)
    return;
  const message = "PostgreSQL channel names must not exceed 63 UTF-8 bytes";
  return new SqlError({
    reason: new UnknownError2({
      cause: new Error(message),
      message,
      operation
    })
  });
};
var normalizeConstraint = (constraint) => {
  if (typeof constraint !== "string")
    return "unknown";
  const normalized = constraint.trim();
  return normalized.length === 0 ? "unknown" : normalized;
};
var classifySqlState = (code, constraint, props) => {
  if (code !== undefined) {
    if (code.startsWith("08")) {
      return new ConnectionError(props);
    }
    if (code.startsWith("28")) {
      return new AuthenticationError(props);
    }
    if (code === "42501") {
      return new AuthorizationError(props);
    }
    if (code.startsWith("42")) {
      return new SqlSyntaxError(props);
    }
    if (code === "23505") {
      return new UniqueViolation({
        ...props,
        constraint: normalizeConstraint(constraint)
      });
    }
    if (code.startsWith("23")) {
      return new ConstraintError(props);
    }
    if (code === "40P01") {
      return new DeadlockError(props);
    }
    if (code === "40001") {
      return new SerializationError(props);
    }
    if (code === "55P03") {
      return new LockTimeoutError(props);
    }
    if (code === "57014") {
      return new StatementTimeoutError(props);
    }
  }
  return new UnknownError2(props);
};

// ../../node_modules/@effect/sql-pg/dist/PgConnection.js
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import * as Net from "node:net";
import * as Tls from "node:tls";

// ../../node_modules/@effect/sql-pg/dist/internal/password.js
var resolve3 = (password) => password === undefined ? succeed6(undefined) : isEffect2(password) ? map6(password, value2) : succeed6(value2(password));

// ../../node_modules/@effect/sql-pg/dist/PgAuth.js
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";

class AuthError extends (/* @__PURE__ */ TaggedError2("PgAuthError")) {
}
var fail9 = (message) => {
  throw new AuthError({
    message
  });
};
var result2 = (evaluate) => {
  try {
    return succeed2(evaluate());
  } catch (error) {
    if (error instanceof AuthError)
      return fail2(error);
    throw error;
  }
};
var textEncoder = /* @__PURE__ */ new TextEncoder;
var textDecoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var maxScramIterations = 1e6;
var bytesOf = (value) => Uint8Array.from(value);
var sha256 = (data) => bytesOf(createHash("sha256").update(data).digest());
var hmacSha256 = (key, data) => bytesOf(createHmac("sha256", key).update(data).digest());
var xor = (left, right) => {
  const result = new Uint8Array(left.length);
  for (let i = 0;i < left.length; i++) {
    result[i] = left[i] ^ right[i];
  }
  return result;
};
var toBase64 = (bytes) => encode(bytes);
var fromBase64 = (text, field) => {
  const decoded = decode(text);
  if (isFailure2(decoded)) {
    return fail9(`Invalid base64 in SCRAM attribute "${field}"`);
  }
  return decoded.success;
};
var decodeUtf8 = (bytes, what) => {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return fail9(`Invalid UTF-8 in ${what}`);
  }
};
var md5PasswordUnsafe = (options) => {
  if (options.salt.length !== 4) {
    return fail9(`PostgreSQL MD5 salt must be exactly 4 bytes, received ${options.salt.length}`);
  }
  const inner = createHash("md5").update(textEncoder.encode(options.password + options.user)).digest("hex");
  const outer = createHash("md5").update(textEncoder.encode(inner)).update(options.salt).digest("hex");
  return `md5${outer}`;
};
var md5Password = (options) => result2(() => md5PasswordUnsafe(options));
var SCRAM_SHA_256 = "SCRAM-SHA-256";
var GS2_HEADER = "n,,";
var CHANNEL_BINDING = "biws";
var parseAttributes = (message) => {
  const attributes = new Map;
  for (const part of message.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      return fail9(`Malformed SCRAM attribute: "${part}"`);
    }
    const key = part.slice(0, separator);
    if (attributes.has(key)) {
      return fail9(`Duplicate SCRAM attribute "${key}"`);
    }
    attributes.set(key, part.slice(separator + 1));
  }
  return attributes;
};
var attribute = (attributes, key) => attributes.get(key) ?? fail9(`Missing SCRAM attribute "${key}"`);
var scramInitUnsafe = (options) => {
  if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(options.nonce)) {
    return fail9("SCRAM nonce must contain only printable ASCII characters other than comma");
  }
  const clientFirstMessageBare = `n=,r=${options.nonce}`;
  return {
    state: {
      _tag: "ScramFirst",
      password: options.password,
      clientNonce: options.nonce,
      clientFirstMessageBare
    },
    response: textEncoder.encode(GS2_HEADER + clientFirstMessageBare)
  };
};
var scramInit = (options) => result2(() => scramInitUnsafe(options));
var scramContinueUnsafe = (state, challenge) => {
  const serverFirstMessage = decodeUtf8(challenge, "the SCRAM server-first-message");
  const attributes = parseAttributes(serverFirstMessage);
  const nonce = attribute(attributes, "r");
  if (!nonce.startsWith(state.clientNonce) || nonce.length === state.clientNonce.length) {
    return fail9("SCRAM server nonce does not extend the client nonce");
  }
  const saltText = attribute(attributes, "s");
  if (saltText.length === 0) {
    return fail9("SCRAM salt must not be empty");
  }
  const salt = fromBase64(saltText, "s");
  const iterationText = attribute(attributes, "i");
  const iterations = Number(iterationText);
  if (!/^[1-9]\d*$/.test(iterationText) || !Number.isSafeInteger(iterations) || iterations > maxScramIterations) {
    return fail9(`Invalid SCRAM iteration count: ${iterationText}`);
  }
  const saltedPassword = bytesOf(pbkdf2Sync(textEncoder.encode(state.password), salt, iterations, 32, "sha256"));
  const clientKey = hmacSha256(saltedPassword, textEncoder.encode("Client Key"));
  const storedKey = sha256(clientKey);
  const clientFinalMessageWithoutProof = `c=${CHANNEL_BINDING},r=${nonce}`;
  const authMessage = textEncoder.encode(`${state.clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`);
  const clientProof = xor(clientKey, hmacSha256(storedKey, authMessage));
  const serverKey = hmacSha256(saltedPassword, textEncoder.encode("Server Key"));
  return {
    state: {
      _tag: "ScramFinal",
      serverSignature: hmacSha256(serverKey, authMessage)
    },
    response: textEncoder.encode(`${clientFinalMessageWithoutProof},p=${toBase64(clientProof)}`)
  };
};
var scramContinue = (state, challenge) => result2(() => scramContinueUnsafe(state, challenge));
var scramFinishUnsafe = (state, challenge) => {
  const attributes = parseAttributes(decodeUtf8(challenge, "the SCRAM server-final-message"));
  const error = attributes.get("e");
  if (error !== undefined) {
    fail9(`SCRAM authentication failed: ${error}`);
  }
  const signature = fromBase64(attribute(attributes, "v"), "v");
  if (toBase64(state.serverSignature) !== toBase64(signature)) {
    fail9("SCRAM server signature mismatch");
  }
};
var scramFinish = (state, challenge) => result2(() => scramFinishUnsafe(state, challenge));

// ../../node_modules/@effect/sql-pg/dist/PgProtocol.js
var defaultMaxMessageSize = 16 * 1024 * 1024;
var maxBufferSize = 64 * 1024;
var makeParser = (options) => {
  const maxMessageSize = options?.maxMessageSize ?? defaultMaxMessageSize;
  const reader = new Reader;
  let bufferSize = 8192;
  let buffer = new Uint8Array(bufferSize);
  let store = buffer.buffer;
  let start = 0;
  let end = 0;
  let failed = false;
  const append = (chunk) => {
    if (end + chunk.length > buffer.length) {
      const pending = end - start;
      if (bufferSize < maxBufferSize)
        bufferSize *= 2;
      let capacity = bufferSize;
      while (capacity < pending + chunk.length)
        capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(buffer.subarray(start, end));
      buffer = next;
      store = next.buffer;
      start = 0;
      end = pending;
    }
    buffer.set(chunk, end);
    end += chunk.length;
  };
  const parser = {
    readField: options?.readField,
    onFieldError: undefined,
    push(chunk) {
      const messages = [];
      parser.pushEach(chunk, (message) => {
        messages.push(message);
      });
      return messages;
    },
    pushEach(chunk, onMessage) {
      if (failed) {
        throw new ParseError({
          message: "Parser cannot be reused after a failure"
        });
      }
      try {
        append(chunk);
        while (end - start >= 5) {
          const length = buffer[start + 1] << 24 | buffer[start + 2] << 16 | buffer[start + 3] << 8 | buffer[start + 4];
          if (length < 4) {
            throw new ParseError({
              message: `Invalid message length: ${length}`
            });
          }
          if (length > maxMessageSize) {
            throw new ParseError({
              message: `Message length ${length} exceeds maxMessageSize ${maxMessageSize}`
            });
          }
          if (end - start < length + 1)
            break;
          const type = buffer[start];
          const body = start + 5;
          const limit = start + 1 + length;
          start = limit;
          if (type === BackendType.DataRow) {
            let row;
            try {
              row = decodeDataRow(buffer, store, 0, body, limit, parser.readField);
            } catch (error) {
              const onFieldError = parser.onFieldError;
              if (onFieldError === undefined || error instanceof ParseError)
                throw error;
              onFieldError(error);
              continue;
            }
            onMessage(row);
          } else {
            reader.reset(buffer, body, limit);
            const message = decodeBackend(type, reader);
            if (reader.offset !== limit) {
              throw new ParseError({
                message: `Message has ${limit - reader.offset} trailing byte(s)`
              });
            }
            onMessage(message);
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  return parser;
};

class ParseError extends (/* @__PURE__ */ TaggedError2("PgProtocolParseError")) {
}

class EncodeError extends (/* @__PURE__ */ TaggedError2("PgProtocolEncodeError")) {
}
var textEncoder2 = /* @__PURE__ */ new TextEncoder;
var textDecoder2 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var asciiEncodeLimit = 48;
var view = (store, offset, length) => new Uint8Array(store, offset, length);
var smallCopyLimit = 8;

class Writer {
  poolSize;
  bytes;
  view;
  start = 0;
  offset = 0;
  isNull = false;
  constructor(poolSize) {
    this.poolSize = poolSize;
    this.bytes = new Uint8Array(poolSize);
    this.view = new DataView(this.bytes.buffer);
  }
  reserve(size) {
    if (this.offset + size <= this.bytes.length)
      return;
    const pending = this.offset - this.start;
    let capacity = this.poolSize;
    while (capacity < pending + size)
      capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(this.start, this.offset));
    this.bytes = next;
    this.view = new DataView(next.buffer);
    this.start = 0;
    this.offset = pending;
  }
  begin() {
    this.start = this.offset;
  }
  uint8(value) {
    this.reserve(1);
    this.bytes[this.offset++] = value;
  }
  int16(value) {
    this.reserve(2);
    const bytes = this.bytes;
    const offset = this.offset;
    bytes[offset] = value >>> 8;
    bytes[offset + 1] = value;
    this.offset = offset + 2;
  }
  int32(value) {
    this.reserve(4);
    this.setInt32(this.offset, value);
    this.offset += 4;
  }
  setInt32(offset, value) {
    const bytes = this.bytes;
    bytes[offset] = value >>> 24;
    bytes[offset + 1] = value >>> 16;
    bytes[offset + 2] = value >>> 8;
    bytes[offset + 3] = value;
  }
  float32(value) {
    this.reserve(4);
    this.view.setFloat32(this.offset, value);
    this.offset += 4;
  }
  float64(value) {
    this.reserve(8);
    this.view.setFloat64(this.offset, value);
    this.offset += 8;
  }
  bigInt64(value) {
    this.reserve(8);
    this.view.setBigInt64(this.offset, value);
    this.offset += 8;
  }
  raw(value) {
    const length = value.length;
    this.reserve(length);
    const bytes = this.bytes;
    const offset = this.offset;
    if (length <= smallCopyLimit) {
      for (let index = 0;index < length; index++)
        bytes[offset + index] = value[index];
    } else {
      bytes.set(value, offset);
    }
    this.offset = offset + length;
  }
  sqlNull() {
    this.isNull = true;
  }
  beginLength() {
    const token = this.offset - this.start;
    this.int32(0);
    return token;
  }
  endLength(token) {
    this.setInt32(this.start + token, this.offset - this.start - token - 4);
  }
  utf8(value, nul = false) {
    const length = value.length;
    if (length <= asciiEncodeLimit) {
      this.reserve(length + (nul ? 1 : 0));
      const bytes = this.bytes;
      const start = this.offset;
      let i = 0;
      for (;i < length; i++) {
        const code = value.charCodeAt(i);
        if (code > 127)
          break;
        bytes[start + i] = code;
      }
      if (i === length) {
        const offset = start + length;
        if (nul)
          bytes[offset] = 0;
        this.offset = offset + (nul ? 1 : 0);
        return;
      }
    }
    this.reserve(length * 3 + (nul ? 1 : 0));
    this.offset += textEncoder2.encodeInto(value, this.bytes.subarray(this.offset)).written;
    if (nul)
      this.bytes[this.offset++] = 0;
  }
  cString(value) {
    this.utf8(value, true);
  }
  finish() {
    const value = view(this.bytes.buffer, this.bytes.byteOffset + this.start, this.offset - this.start);
    if (this.bytes.length > this.poolSize) {
      this.bytes = new Uint8Array(this.poolSize);
      this.view = new DataView(this.bytes.buffer);
      this.start = 0;
      this.offset = 0;
    } else {
      this.start = this.offset;
    }
    return value;
  }
}
var emptyBytes = /* @__PURE__ */ new Uint8Array(0);

class Reader {
  bytes = emptyBytes;
  store = emptyBytes.buffer;
  base = 0;
  offset = 0;
  limit = 0;
  reset(bytes, offset, limit) {
    this.bytes = bytes;
    this.store = bytes.buffer;
    this.base = bytes.byteOffset;
    this.offset = offset;
    this.limit = limit;
  }
  require(size) {
    if (size < 0) {
      throw new ParseError({
        message: `Invalid read of ${size} byte(s)`
      });
    }
    if (this.offset + size > this.limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
  }
  uint8() {
    this.require(1);
    return this.bytes[this.offset++];
  }
  int16() {
    this.require(2);
    const bytes = this.bytes;
    const offset = this.offset;
    this.offset = offset + 2;
    return (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
  }
  int32() {
    this.require(4);
    const bytes = this.bytes;
    const offset = this.offset;
    this.offset = offset + 4;
    return bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];
  }
  uint32() {
    return this.int32() >>> 0;
  }
  raw(size) {
    this.require(size);
    const value = view(this.store, this.base + this.offset, size);
    this.offset += size;
    return value;
  }
  rest() {
    return this.raw(this.limit - this.offset);
  }
  cString() {
    const end = this.bytes.indexOf(0, this.offset);
    if (end === -1 || end >= this.limit) {
      throw new ParseError({
        message: "Unterminated string"
      });
    }
    const value = decodeUtf82(this.bytes, this.offset, end - this.offset);
    this.offset = end + 1;
    return value;
  }
}
var asciiDecodeLimit = 10;
var utf8Slice = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf82 = (bytes, offset, size) => {
  if (size <= asciiDecodeLimit) {
    let text = "";
    let index = 0;
    for (;index < size; index++) {
      const code = bytes[offset + index];
      if (code > 127)
        break;
      text += String.fromCharCode(code);
    }
    if (index === size)
      return text;
  }
  if (utf8Slice !== undefined) {
    const text = utf8Slice.call(bytes, offset, offset + size);
    if (text.indexOf("�") === -1)
      return text;
  }
  try {
    return textDecoder2.decode(view(bytes.buffer, bytes.byteOffset + offset, size));
  } catch {
    throw new ParseError({
      message: "Invalid UTF-8 in message"
    });
  }
};
var sharedWriter = /* @__PURE__ */ new Writer(8192);
var begin = (type) => {
  const writer = sharedWriter;
  writer.begin();
  writer.reserve(5);
  const bytes = writer.bytes;
  const offset = writer.offset;
  bytes[offset] = type;
  writer.offset = offset + 5;
  return writer;
};
var end = () => {
  sharedWriter.setInt32(sharedWriter.start + 1, sharedWriter.offset - sharedWriter.start - 1);
  return sharedWriter.finish();
};
var empty6 = (type) => {
  const writer = begin(type);
  writer.setInt32(writer.start + 1, 4);
  return writer.finish();
};
var targetByte = (target) => target === "statement" ? 83 : 80;
var requireUint16Count = (count, name) => {
  if (count > 65535)
    throw new EncodeError({
      message: `${name} count exceeds 65535: ${count}`
    });
  return count;
};
var encodeResult = (evaluate) => {
  try {
    return succeed2(evaluate());
  } catch (error) {
    if (error instanceof EncodeError)
      return fail2(error);
    throw error;
  }
};
var encodeParseUnsafe = (options) => {
  const writer = begin(80);
  writer.cString(options.name);
  writer.cString(options.query);
  const parameterTypes = options.parameterTypes;
  const count = requireUint16Count(parameterTypes.length, "Parse parameter type");
  writer.reserve(2 + count * 4);
  const bytes = writer.bytes;
  let offset = writer.offset;
  bytes[offset] = count >>> 8;
  bytes[offset + 1] = count;
  offset += 2;
  for (let index = 0;index < count; index++) {
    const oid = parameterTypes[index];
    bytes[offset] = oid >>> 24;
    bytes[offset + 1] = oid >>> 16;
    bytes[offset + 2] = oid >>> 8;
    bytes[offset + 3] = oid;
    offset += 4;
  }
  writer.offset = offset;
  return end();
};
var encodeParse = (options) => encodeResult(() => encodeParseUnsafe(options));
var valueWriterUnsafe = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
var makeBindEncoder = (writeParameter, textFormat) => (options) => {
  try {
    const writer = begin(66);
    writer.cString(options.portal);
    writer.cString(options.statement);
    const parameters = options.parameters;
    const count = requireUint16Count(parameters.length, "Bind parameter");
    let textCount = 0;
    if (textFormat !== undefined) {
      for (let index = 0;index < count; index++) {
        if (textFormat(parameters[index]))
          textCount++;
      }
    }
    if (textCount === 0 || textCount === count) {
      const code = textCount === 0 ? 1 : 0;
      writer.reserve(6);
      const header = writer.bytes;
      const headerOffset = writer.offset;
      header[headerOffset] = 0;
      header[headerOffset + 1] = 1;
      header[headerOffset + 2] = 0;
      header[headerOffset + 3] = code;
      header[headerOffset + 4] = count >>> 8;
      header[headerOffset + 5] = count;
      writer.offset = headerOffset + 6;
    } else {
      writer.int16(count);
      for (let index = 0;index < count; index++) {
        writer.int16(textFormat(parameters[index]) ? 0 : 1);
      }
      writer.int16(count);
    }
    const writeUnsafe = writeParameter[valueWriterUnsafe];
    for (let index = 0;index < count; index++) {
      const token = writer.beginLength();
      writer.isNull = false;
      if (writeUnsafe === undefined) {
        const written = writeParameter(writer, parameters[index]);
        if (isFailure2(written))
          return fail2(written.failure);
      } else {
        writeUnsafe(writer, parameters[index]);
      }
      if (writer.isNull) {
        writer.isNull = false;
        writer.offset = writer.start + token;
        writer.int32(-1);
      } else {
        writer.endLength(token);
      }
    }
    writer.reserve(4);
    const trailer = writer.bytes;
    const trailerOffset = writer.offset;
    trailer[trailerOffset] = 0;
    trailer[trailerOffset + 1] = 1;
    trailer[trailerOffset + 2] = 0;
    trailer[trailerOffset + 3] = 1;
    writer.offset = trailerOffset + 4;
    return succeed2(end());
  } catch (error) {
    if (error instanceof EncodeError)
      return fail2(error);
    throw error;
  }
};
var encodeExecute = (options) => {
  const writer = begin(69);
  writer.cString(options.portal);
  writer.int32(options.maxRows);
  return end();
};
var encodeDescribe = (options) => {
  const writer = begin(68);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeClose = (options) => {
  const writer = begin(67);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeSync = () => empty6(83);
var encodeTerminate = () => empty6(88);
var encodePasswordMessage = (options) => {
  const writer = begin(112);
  writer.cString(options.password);
  return end();
};
var encodeSASLInitialResponse = (options) => {
  const writer = begin(112);
  writer.cString(options.mechanism);
  if (options.initialResponse === null) {
    writer.int32(-1);
  } else {
    writer.int32(options.initialResponse.length);
    writer.raw(options.initialResponse);
  }
  return end();
};
var encodeSASLResponse = (options) => {
  const writer = begin(112);
  writer.raw(options.data);
  return end();
};
var PROTOCOL_VERSION_3_0 = 196608;
var SSL_REQUEST_CODE = 80877103;
var CANCEL_REQUEST_CODE = 80877102;
var encodeSslRequest = () => {
  sharedWriter.begin();
  sharedWriter.int32(8);
  sharedWriter.int32(SSL_REQUEST_CODE);
  return sharedWriter.finish();
};
var decodeSslResponse = (byte) => byte === 83 ? succeed2("S") : byte === 78 ? succeed2("N") : fail2(new ParseError({
  message: `Invalid SSLRequest response byte: ${byte}`
}));
var encodeStartupMessage = (parameters) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(0);
  writer.int32(PROTOCOL_VERSION_3_0);
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined)
      continue;
    writer.cString(key);
    writer.cString(value);
  }
  if (parameters.client_encoding === undefined) {
    writer.cString("client_encoding");
    writer.cString("UTF8");
  }
  writer.uint8(0);
  writer.setInt32(writer.start, writer.offset - writer.start);
  return writer.finish();
};
var encodeCancelRequest = (options) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(16);
  writer.int32(CANCEL_REQUEST_CODE);
  writer.int32(options.pid);
  writer.int32(options.secret);
  return writer.finish();
};
var BackendType = {
  NotificationResponse: 65,
  CommandComplete: 67,
  DataRow: 68,
  ErrorResponse: 69,
  CopyInResponse: 71,
  CopyOutResponse: 72,
  EmptyQueryResponse: 73,
  BackendKeyData: 75,
  NoticeResponse: 78,
  Authentication: 82,
  ParameterStatus: 83,
  RowDescription: 84,
  CopyBothResponse: 87,
  ReadyForQuery: 90,
  CopyDone: 99,
  CopyData: 100,
  NoData: 110,
  PortalSuspended: 115,
  ParameterDescription: 116,
  NegotiateProtocolVersion: 118,
  ParseComplete: 49,
  BindComplete: 50,
  CloseComplete: 51
};
var errorFieldNames = {
  S: "severity",
  V: "severityUnlocalized",
  C: "code",
  M: "message",
  D: "detail",
  H: "hint",
  P: "position",
  p: "internalPosition",
  q: "internalQuery",
  W: "where",
  s: "schema",
  t: "table",
  c: "column",
  d: "dataType",
  n: "constraint",
  F: "file",
  L: "line",
  R: "routine"
};
var decodeAuthentication = (reader) => {
  const method = reader.int32();
  switch (method) {
    case 0:
      return {
        _tag: "AuthenticationOk"
      };
    case 3:
      return {
        _tag: "AuthenticationCleartextPassword"
      };
    case 5:
      return {
        _tag: "AuthenticationMD5Password",
        salt: reader.raw(4)
      };
    case 10: {
      const mechanisms = [];
      for (;; ) {
        const mechanism = reader.cString();
        if (mechanism === "")
          break;
        mechanisms.push(mechanism);
      }
      return {
        _tag: "AuthenticationSASL",
        mechanisms
      };
    }
    case 11:
      return {
        _tag: "AuthenticationSASLContinue",
        data: reader.rest()
      };
    case 12:
      return {
        _tag: "AuthenticationSASLFinal",
        data: reader.rest()
      };
    default:
      return {
        _tag: "AuthenticationUnsupported",
        method,
        payload: reader.rest()
      };
  }
};
var decodeErrorFields = (reader) => {
  const fields = {};
  for (;; ) {
    const code = reader.uint8();
    if (code === 0)
      break;
    const key = String.fromCharCode(code);
    fields[errorFieldNames[key] ?? key] = reader.cString();
  }
  return fields;
};
var requireNonNegativeCount = (count, name) => {
  if (count < 0) {
    throw new ParseError({
      message: `Invalid ${name} count: ${count}`
    });
  }
  return count;
};
var decodeCopyResponse = (reader) => {
  const format = reader.uint8();
  const count = requireNonNegativeCount(reader.int16(), "COPY column");
  const columnFormats = new Array(count);
  for (let i = 0;i < count; i++) {
    columnFormats[i] = reader.int16();
  }
  return {
    format,
    columnFormats
  };
};
var decodeDataRow = (bytes, store, base, offset, limit, readField) => {
  if (offset + 2 > limit) {
    throw new ParseError({
      message: "Truncated message: expected 2 more byte(s)"
    });
  }
  const count = (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
  if (count < 0) {
    throw new ParseError({
      message: `Invalid DataRow field count: ${count}`
    });
  }
  const values = new Array(count);
  let position = offset + 2;
  for (let i = 0;i < count; i++) {
    if (position + 4 > limit) {
      throw new ParseError({
        message: "Truncated message: expected 4 more byte(s)"
      });
    }
    const size = bytes[position] << 24 | bytes[position + 1] << 16 | bytes[position + 2] << 8 | bytes[position + 3];
    position += 4;
    if (size < 0) {
      if (size < -1) {
        throw new ParseError({
          message: `Invalid DataRow field length: ${size}`
        });
      }
      values[i] = readField === undefined ? null : readField(bytes, position, -1, i);
      continue;
    }
    const next = position + size;
    if (next > limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
    values[i] = readField === undefined ? view(store, base + position, size) : readField(bytes, position, size, i);
    position = next;
  }
  if (position !== limit) {
    throw new ParseError({
      message: `DataRow has ${limit - position} trailing byte(s)`
    });
  }
  return {
    _tag: "DataRow",
    values
  };
};
var decodeBackend = (type, reader) => {
  switch (type) {
    case BackendType.Authentication:
      return decodeAuthentication(reader);
    case BackendType.ParameterStatus:
      return {
        _tag: "ParameterStatus",
        name: reader.cString(),
        value: reader.cString()
      };
    case BackendType.BackendKeyData:
      return {
        _tag: "BackendKeyData",
        pid: reader.int32(),
        secret: reader.int32()
      };
    case BackendType.ReadyForQuery: {
      const status = String.fromCharCode(reader.uint8());
      if (status !== "I" && status !== "T" && status !== "E") {
        throw new ParseError({
          message: `Invalid ReadyForQuery status: ${status}`
        });
      }
      return {
        _tag: "ReadyForQuery",
        status
      };
    }
    case BackendType.RowDescription: {
      const count = requireNonNegativeCount(reader.int16(), "RowDescription field");
      const fields = new Array(count);
      for (let i = 0;i < count; i++) {
        fields[i] = {
          name: reader.cString(),
          tableOid: reader.uint32(),
          columnAttributeNumber: reader.int16(),
          dataTypeOid: reader.uint32(),
          dataTypeSize: reader.int16(),
          typeModifier: reader.int32(),
          format: reader.int16()
        };
      }
      return {
        _tag: "RowDescription",
        fields
      };
    }
    case BackendType.DataRow:
      return decodeDataRow(reader.bytes, reader.store, reader.base, reader.offset, reader.limit, undefined);
    case BackendType.CommandComplete:
      return {
        _tag: "CommandComplete",
        commandTag: reader.cString()
      };
    case BackendType.EmptyQueryResponse:
      return {
        _tag: "EmptyQueryResponse"
      };
    case BackendType.NoData:
      return {
        _tag: "NoData"
      };
    case BackendType.ParseComplete:
      return {
        _tag: "ParseComplete"
      };
    case BackendType.BindComplete:
      return {
        _tag: "BindComplete"
      };
    case BackendType.CloseComplete:
      return {
        _tag: "CloseComplete"
      };
    case BackendType.PortalSuspended:
      return {
        _tag: "PortalSuspended"
      };
    case BackendType.ParameterDescription: {
      const count = requireNonNegativeCount(reader.int16(), "ParameterDescription parameter");
      const parameterTypes = new Array(count);
      for (let i = 0;i < count; i++) {
        parameterTypes[i] = reader.uint32();
      }
      return {
        _tag: "ParameterDescription",
        parameterTypes
      };
    }
    case BackendType.ErrorResponse:
      return {
        _tag: "ErrorResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NoticeResponse:
      return {
        _tag: "NoticeResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NotificationResponse:
      return {
        _tag: "NotificationResponse",
        pid: reader.int32(),
        channel: reader.cString(),
        payload: reader.cString()
      };
    case BackendType.NegotiateProtocolVersion: {
      const minorVersion = reader.int32();
      const count = requireNonNegativeCount(reader.int32(), "NegotiateProtocolVersion option");
      const unrecognizedOptions = new Array(count);
      for (let i = 0;i < count; i++) {
        unrecognizedOptions[i] = reader.cString();
      }
      return {
        _tag: "NegotiateProtocolVersion",
        minorVersion,
        unrecognizedOptions
      };
    }
    case BackendType.CopyInResponse:
      return {
        _tag: "CopyInResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyOutResponse:
      return {
        _tag: "CopyOutResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyBothResponse:
      return {
        _tag: "CopyBothResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyData:
      return {
        _tag: "CopyData",
        data: reader.rest()
      };
    case BackendType.CopyDone:
      return {
        _tag: "CopyDone"
      };
    default:
      return {
        _tag: "Unknown",
        type,
        payload: reader.rest()
      };
  }
};

// ../../node_modules/@effect/sql-pg/dist/PgTypes.js
class CodecError extends (/* @__PURE__ */ TaggedError2("PgTypesCodecError")) {
}
var fail10 = (message) => {
  throw new CodecError({
    message
  });
};
var result3 = (evaluate) => {
  try {
    return succeed2(evaluate());
  } catch (error) {
    if (error instanceof CodecError)
      return fail2(error);
    throw error;
  }
};
var textEncoder3 = /* @__PURE__ */ new TextEncoder;
var textDecoder3 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var writeInt16 = (bytes, offset, value) => {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value;
};
var readInt16 = (bytes, offset) => (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
var readUint16 = (bytes, offset) => bytes[offset] << 8 | bytes[offset + 1];
var writeInt32 = (bytes, offset, value) => {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
};
var readInt32 = (bytes, offset) => bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];
var writeInt64 = (bytes, offset, value) => {
  const high = Math.floor(value / 4294967296);
  writeInt32(bytes, offset, high);
  writeInt32(bytes, offset + 4, value - high * 4294967296);
};
var readUint32 = (bytes, offset) => (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
var scratch4 = /* @__PURE__ */ new ArrayBuffer(4);
var scratchView4 = /* @__PURE__ */ new DataView(scratch4);
var scratchBytes4 = /* @__PURE__ */ new Uint8Array(scratch4);
var scratch8 = /* @__PURE__ */ new ArrayBuffer(8);
var scratchView8 = /* @__PURE__ */ new DataView(scratch8);
var scratchBytes8 = /* @__PURE__ */ new Uint8Array(scratch8);
var stage8 = (bytes, offset) => {
  scratchView8.setInt32(0, readInt32(bytes, offset));
  scratchView8.setInt32(4, readInt32(bytes, offset + 4));
};
var twoDigits = /* @__PURE__ */ Array.from({
  length: 100
}, (_, value) => (value < 10 ? "0" : "") + value);
var asciiEncodeLimit2 = 48;
var scratchUtf8 = /* @__PURE__ */ new Uint8Array(4096);
var scratchUtf8Limit = 64 * 1024;
var encodeUtf8Scratch = (text) => {
  const capacity = text.length * 3;
  if (capacity > scratchUtf8Limit)
    return -1;
  if (capacity > scratchUtf8.length)
    scratchUtf8 = new Uint8Array(capacity);
  return textEncoder3.encodeInto(text, scratchUtf8).written;
};
var encodeUtf8 = (text) => {
  const length = text.length;
  if (length <= asciiEncodeLimit2) {
    const bytes = new Uint8Array(length);
    let i = 0;
    for (;i < length; i++) {
      const code = text.charCodeAt(i);
      if (code > 127)
        break;
      bytes[i] = code;
    }
    if (i === length)
      return bytes;
  }
  const written = encodeUtf8Scratch(text);
  return written === -1 ? textEncoder3.encode(text) : scratchUtf8.slice(0, written);
};
var encodeUtf8Prefixed = (text, prefix) => {
  const length = text.length;
  if (length <= asciiEncodeLimit2) {
    const bytes = new Uint8Array(prefix + length);
    let i = 0;
    for (;i < length; i++) {
      const code = text.charCodeAt(i);
      if (code > 127)
        break;
      bytes[prefix + i] = code;
    }
    if (i === length)
      return bytes;
  }
  const written = encodeUtf8Scratch(text);
  if (written === -1) {
    const body = textEncoder3.encode(text);
    const bytes = new Uint8Array(prefix + body.length);
    bytes.set(body, prefix);
    return bytes;
  }
  const bytes = new Uint8Array(prefix + written);
  bytes.set(scratchUtf8.subarray(0, written), prefix);
  return bytes;
};
var region = (bytes, offset, size) => offset === 0 && size === bytes.length ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset + offset, size);
var asciiDecodeLimit2 = 10;
var utf8Slice2 = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf83 = (bytes, offset, size) => {
  if (size <= asciiDecodeLimit2) {
    let text = "";
    let index = 0;
    for (;index < size; index++) {
      const code = bytes[offset + index];
      if (code > 127)
        break;
      text += String.fromCharCode(code);
    }
    if (index === size)
      return text;
  }
  if (utf8Slice2 !== undefined) {
    const text = utf8Slice2.call(bytes, offset, offset + size);
    if (text.indexOf("�") === -1)
      return text;
  }
  try {
    return textDecoder3.decode(region(bytes, offset, size));
  } catch {
    return fail10("Invalid UTF-8 in text value");
  }
};
var decodeUnregistered = (bytes, offset, size, oid, column, index) => {
  let text;
  try {
    text = decodeUtf83(bytes, offset, size);
  } catch {
    return failUnregistered("is not valid UTF-8", oid, column, index);
  }
  if (text.indexOf("\x00") !== -1) {
    return failUnregistered("contains a NUL byte, so it is binary data rather than text", oid, column, index);
  }
  return text;
};
var failUnregistered = (reason, oid, column, index) => {
  let subject;
  if (column === undefined) {
    subject = `a value of type OID ${oid}`;
  } else {
    const name = column.name === undefined ? `${index}` : JSON.stringify(column.name);
    const table = column.tableOid === undefined || column.tableOid === 0 ? "" : `, table OID ${column.tableOid}, attribute number ${column.columnAttributeNumber}`;
    subject = `column ${name} (type OID ${oid}${table})`;
  }
  return fail10(`Cannot decode ${subject}: no codec is registered for the type, so it is read as UTF-8 text, ` + `but the value ${reason}. Register a codec with PgTypes.makeRegistry().register and pass the registry ` + `as the client's types option, or cast the value to text in the query.`);
};
var requireSize = (size, expected, name) => {
  if (size !== expected) {
    fail10(`Expected ${expected} byte(s) for ${name}, received ${size}`);
  }
};
var requireString = (value, name) => typeof value === "string" ? value : fail10(`Expected a string for ${name}`);
var requireBigInt = (value, name) => typeof value === "bigint" ? value : fail10(`Expected a bigint for ${name}`);
var requireNumber = (value, name) => typeof value === "number" ? value : fail10(`Expected a number for ${name}`);
var requireInteger = (value, name, min, max) => {
  const num = requireNumber(value, name);
  if (!Number.isInteger(num) || num < min || num > max) {
    fail10(`Expected an integer in [${min}, ${max}] for ${name}, received ${num}`);
  }
  return num;
};
var ZERO = /* @__PURE__ */ BigInt(0);
var THOUSAND = /* @__PURE__ */ BigInt(1000);
var INT64_MIN = /* @__PURE__ */ BigInt("-9223372036854775808");
var INT64_MAX = /* @__PURE__ */ BigInt("9223372036854775807");
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;
var PG_EPOCH_MS = 946684800000;
var PG_EPOCH_MICROS = 946684800000000;
var PG_EPOCH_DAYS = 10957;
var MAX_EXACT = 9007199254740992;
var MAX_EXACT_HIGH = 2097152;
var MAX_TIME_MICROS_NUMBER = 86400000000;
var TZDISP_LIMIT_SECONDS = 57600;
var OID = {
  bool: 16,
  bytea: 17,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  cidr: 650,
  float4: 700,
  float8: 701,
  inet: 869,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  timetz: 1266,
  numeric: 1700,
  regclass: 2205,
  uuid: 2950,
  jsonb: 3802,
  boolArray: 1000,
  byteaArray: 1001,
  nameArray: 1003,
  int8Array: 1016,
  int2Array: 1005,
  int4Array: 1007,
  textArray: 1009,
  oidArray: 1028,
  jsonArray: 199,
  cidrArray: 651,
  float4Array: 1021,
  float8Array: 1022,
  inetArray: 1041,
  bpcharArray: 1014,
  varcharArray: 1015,
  dateArray: 1182,
  timeArray: 1183,
  timestampArray: 1115,
  timestamptzArray: 1185,
  intervalArray: 1187,
  timetzArray: 1270,
  numericArray: 1231,
  regclassArray: 2210,
  uuidArray: 2951,
  jsonbArray: 3807
};
var arrayToElement = /* @__PURE__ */ new Map([[OID.boolArray, OID.bool], [OID.byteaArray, OID.bytea], [OID.nameArray, OID.name], [OID.int8Array, OID.int8], [OID.int2Array, OID.int2], [OID.int4Array, OID.int4], [OID.textArray, OID.text], [OID.oidArray, OID.oid], [OID.jsonArray, OID.json], [OID.cidrArray, OID.cidr], [OID.float4Array, OID.float4], [OID.float8Array, OID.float8], [OID.inetArray, OID.inet], [OID.bpcharArray, OID.bpchar], [OID.varcharArray, OID.varchar], [OID.dateArray, OID.date], [OID.timeArray, OID.time], [OID.timestampArray, OID.timestamp], [OID.timestamptzArray, OID.timestamptz], [OID.intervalArray, OID.interval], [OID.timetzArray, OID.timetz], [OID.numericArray, OID.numeric], [OID.regclassArray, OID.regclass], [OID.uuidArray, OID.uuid], [OID.jsonbArray, OID.jsonb]]);
var elementToArray = /* @__PURE__ */ new Map(/* @__PURE__ */ Array.from(arrayToElement, ([array, element]) => [element, array]));
var arrayOidFor = (elementOid, registry) => registry === undefined ? elementToArray.get(elementOid) : getRegistryState(registry).elementToArray.get(elementOid);
var pad = (value, size) => String(value).padStart(size, "0");
var civilFromDays = (days) => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return {
    year: month <= 2 ? y + 1 : y,
    month,
    day
  };
};
var daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};
var monthLengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var isLeapYear = (year) => year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
var twoDigitsAt = (text, at) => {
  const tens = text.charCodeAt(at) - 48;
  const units = text.charCodeAt(at + 1) - 48;
  return tens >= 0 && tens <= 9 && units >= 0 && units <= 9 ? tens * 10 + units : -1;
};
var parseDate = (text) => {
  const yearStart = text.charCodeAt(0) === 45 ? 1 : 0;
  const yearEnd = text.length - 6;
  if (yearEnd - yearStart < 4 || text.charCodeAt(yearEnd) !== 45 || text.charCodeAt(yearEnd + 3) !== 45) {
    return fail10(`Expected a YYYY-MM-DD date, received "${text}"`);
  }
  let year = 0;
  for (let index = yearStart;index < yearEnd; index++) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      return fail10(`Expected a YYYY-MM-DD date, received "${text}"`);
    }
    year = year * 10 + digit;
  }
  const month = twoDigitsAt(text, yearEnd + 1);
  const day = twoDigitsAt(text, yearEnd + 4);
  if (month === -1 || day === -1) {
    return fail10(`Expected a YYYY-MM-DD date, received "${text}"`);
  }
  if (yearStart === 1)
    year = -year;
  if (!Number.isFinite(year)) {
    return fail10(`date out of range: "${text}"`);
  }
  const monthLength = month === 2 && isLeapYear(year) ? 29 : monthLengths[month];
  if (month < 1 || month > 12 || day < 1 || day > monthLength) {
    return fail10(`Invalid date "${text}"`);
  }
  return daysFromCivil(year, month, day);
};
var formatDate2 = (days) => {
  const {
    day,
    month,
    year
  } = civilFromDays(days);
  const yearText = year < 0 ? `-${pad(-year, 4)}` : year < 1e4 ? twoDigits[year / 100 | 0] + twoDigits[year % 100] : String(year);
  return `${yearText}-${twoDigits[month]}-${twoDigits[day]}`;
};
var timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
var parseTimeOfDay = (text) => {
  const match = timeRegex.exec(text);
  if (match === null) {
    return fail10(`Expected a HH:MM[:SS[.ffffff]] time, received "${text}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  const fraction = match[4] === undefined ? 0 : Number(match[4].padEnd(6, "0"));
  const micros = (hours * 3600 + minutes * 60 + seconds) * 1e6 + fraction;
  if (hours > 24 || minutes > 59 || seconds > 60 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail10(`Invalid time "${text}"`);
  }
  return micros;
};
var formatTimeOfDay = (micros) => {
  const seconds = micros / 1e6 | 0;
  const fraction = micros - seconds * 1e6;
  const base = `${twoDigits[seconds / 3600 | 0]}:${twoDigits[(seconds / 60 | 0) % 60]}:${twoDigits[seconds % 60]}`;
  if (fraction === 0)
    return base;
  return `${base}.${pad(fraction, 6).replace(/0+$/, "")}`;
};
var zoneRegex = /^(?:Z|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)$/;
var parseZone = (text) => {
  const match = zoneRegex.exec(text);
  if (match === null) {
    return fail10(`Expected a time zone offset, received "${text}"`);
  }
  if (match[1] === undefined)
    return 0;
  const minutes = match[3] === undefined ? 0 : Number(match[3]);
  const trailingSeconds = match[4] === undefined ? 0 : Number(match[4]);
  const seconds = Number(match[2]) * 3600 + minutes * 60 + trailingSeconds;
  if (minutes > 59 || trailingSeconds > 59 || seconds >= TZDISP_LIMIT_SECONDS) {
    return fail10(`Time zone offset out of range, received "${text}"`);
  }
  return match[1] === "-" ? -seconds : seconds;
};
var formatZone = (secondsEast) => {
  const sign = secondsEast < 0 ? "-" : "+";
  const total = Math.abs(secondsEast);
  return `${sign}${pad(total / 3600 | 0, 2)}:${twoDigits[(total / 60 | 0) % 60]}`;
};
var NUMERIC_POS = 0;
var NUMERIC_NEG = 16384;
var NUMERIC_NAN = 49152;
var NUMERIC_PINF = 53248;
var NUMERIC_NINF = 61440;
var numericRegex = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
var encodeNumeric = (value) => {
  const text = requireString(value, "numeric");
  if (text === "NaN")
    return numericSpecial(NUMERIC_NAN);
  if (text === "Infinity")
    return numericSpecial(NUMERIC_PINF);
  if (text === "-Infinity")
    return numericSpecial(NUMERIC_NINF);
  const match = numericRegex.exec(text);
  if (match === null || (match[2] ?? "") + (match[3] ?? "") === "") {
    return fail10(`Expected a decimal numeric string, received "${text}"`);
  }
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  let digits = (match[2] ?? "") + (match[3] ?? "");
  let scale = (match[3] ?? "").length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 16383) {
    return fail10(`numeric scale ${scale} exceeds the PostgreSQL maximum`);
  }
  const rightPad = (4 - scale % 4) % 4;
  digits += "0".repeat(rightPad);
  const fractionLength = scale + rightPad;
  const leftPad = (4 - (digits.length - fractionLength) % 4) % 4;
  digits = "0".repeat(leftPad) + digits;
  const groupAt = (index) => {
    const at = index * 4;
    return (digits.charCodeAt(at) - 48) * 1000 + (digits.charCodeAt(at + 1) - 48) * 100 + (digits.charCodeAt(at + 2) - 48) * 10 + (digits.charCodeAt(at + 3) - 48);
  };
  const groupCount = digits.length / 4;
  let first = 0;
  while (first < groupCount && groupAt(first) === 0)
    first++;
  let last = groupCount;
  while (last > first && groupAt(last - 1) === 0)
    last--;
  const count = last - first;
  const weight = count === 0 ? 0 : (digits.length - fractionLength) / 4 - 1 - first;
  const sign = count > 0 && match[1] === "-" ? NUMERIC_NEG : NUMERIC_POS;
  const bytes = new Uint8Array(8 + count * 2);
  writeInt16(bytes, 0, count);
  writeInt16(bytes, 2, weight);
  writeInt16(bytes, 4, sign);
  writeInt16(bytes, 6, scale);
  for (let i = 0;i < count; i++) {
    writeInt16(bytes, 8 + i * 2, groupAt(first + i));
  }
  return bytes;
};
var numericSpecial = (sign) => {
  const bytes = new Uint8Array(8);
  writeInt16(bytes, 4, sign);
  return bytes;
};
var decodeNumeric = (bytes, offset, size) => {
  if (size < 8)
    return fail10("Truncated numeric value");
  const count = readInt16(bytes, offset);
  const weight = readInt16(bytes, offset + 2);
  const sign = readUint16(bytes, offset + 4);
  const scale = readInt16(bytes, offset + 6);
  if (sign === NUMERIC_NAN)
    return "NaN";
  if (sign === NUMERIC_PINF)
    return "Infinity";
  if (sign === NUMERIC_NINF)
    return "-Infinity";
  if (sign !== NUMERIC_POS && sign !== NUMERIC_NEG) {
    return fail10(`Invalid numeric sign: ${sign}`);
  }
  requireSize(size, 8 + count * 2, "numeric");
  const digits = offset + 8;
  const digitAt = (index) => {
    if (index < 0 || index >= count)
      return 0;
    const digit = readInt16(bytes, digits + index * 2);
    return digit >= 0 && digit <= 9999 ? digit : fail10(`Invalid numeric digit: ${digit}`);
  };
  let result = sign === NUMERIC_NEG ? "-" : "";
  if (weight < 0) {
    result += "0";
  } else {
    for (let i = 0;i <= weight; i++) {
      const digit = digitAt(i);
      if (i === 0) {
        result += String(digit);
      } else {
        result += twoDigits[digit / 100 | 0];
        result += twoDigits[digit % 100];
      }
    }
  }
  if (scale > 0) {
    let fraction = "";
    for (let i = weight + 1;fraction.length < scale; i++) {
      const digit = digitAt(i);
      fraction += twoDigits[digit / 100 | 0];
      fraction += twoDigits[digit % 100];
    }
    result += `.${fraction.slice(0, scale)}`;
  }
  return result;
};
var PGSQL_AF_INET = 2;
var PGSQL_AF_INET6 = 3;
var encodeInet = (value, isCidr) => {
  const type = isCidr ? "cidr" : "inet";
  const text = requireString(value, type);
  const parsed = fromString(text);
  if (isFailure2(parsed))
    return fail10(`Invalid ${type} value ${JSON.stringify(text)}: ${parsed.failure.message}`);
  const address = parsed.success.address;
  const bits = parsed.success.prefixLength;
  if (isCidr) {
    const network = make16(address, bits);
    if (isFailure2(network)) {
      return fail10(`Invalid ${type} value ${JSON.stringify(text)}: ${network.failure.message}`);
    }
  }
  const octets = isIpv4Address(address) ? ipv4ToOctets(address) : ipv6ToOctets(address);
  const result = new Uint8Array(4 + octets.length);
  result[0] = isIpv4Address(address) ? PGSQL_AF_INET : PGSQL_AF_INET6;
  result[1] = bits;
  result[2] = isCidr ? 1 : 0;
  result[3] = octets.length;
  result.set(octets, 4);
  return result;
};
var decodeInet = (bytes, offset, size) => {
  if (size < 4)
    return fail10("Truncated inet value");
  const family = bytes[offset];
  const bits = bytes[offset + 1];
  const cidrFlag = bytes[offset + 2];
  if (cidrFlag > 1)
    return fail10(`Invalid inet CIDR flag: ${cidrFlag}`);
  const isCidr = cidrFlag === 1;
  const addressSize = bytes[offset + 3];
  const expected = family === PGSQL_AF_INET ? 4 : family === PGSQL_AF_INET6 ? 16 : -1;
  if (expected === -1 || addressSize !== expected) {
    return fail10(`Invalid inet address family ${family} with ${addressSize} byte(s)`);
  }
  requireSize(size, 4 + addressSize, "inet");
  if (bits > addressSize * 8)
    return fail10(`Invalid inet netmask length: ${bits}`);
  const addressBytes = bytes.slice(offset + 4, offset + 4 + addressSize);
  const address = family === PGSQL_AF_INET ? ipv4FromBytesUnsafe(addressBytes) : ipv6FromBytesUnsafe(addressBytes);
  if (isCidr) {
    const network = make16(address, bits);
    if (isFailure2(network))
      return fail10(network.failure.message);
    return format4(network.success);
  }
  return bits === addressSize * 8 ? formatIp(address) : format3(makeUnsafe6(address, bits));
};
var hexDigits = "0123456789abcdef";
var hexValues = /* @__PURE__ */ new Int8Array(128).fill(-1);
for (let i = 0;i < 16; i++) {
  hexValues[/* @__PURE__ */ hexDigits.charCodeAt(i)] = i;
  hexValues[/* @__PURE__ */ "0123456789ABCDEF".charCodeAt(i)] = i;
}
var hexHigh = /* @__PURE__ */ (() => {
  const codes = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0;i < 256; i++)
    codes[i] = /* @__PURE__ */ hexDigits.charCodeAt(i >> 4);
  return codes;
})();
var hexLow = /* @__PURE__ */ (() => {
  const codes = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0;i < 256; i++)
    codes[i] = /* @__PURE__ */ hexDigits.charCodeAt(i & 15);
  return codes;
})();
var uuidOffsets = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34];
var hexAt = (text, at) => {
  const code = text.charCodeAt(at);
  return code < 128 ? hexValues[code] : -1;
};
var uuidWord = /* @__PURE__ */ new Int32Array(4);
var uuidWords = (value) => {
  const text = requireString(value, "uuid");
  if (text.length !== 36 || text.charCodeAt(8) !== 45 || text.charCodeAt(13) !== 45 || text.charCodeAt(18) !== 45 || text.charCodeAt(23) !== 45) {
    return fail10(`Expected a UUID, received "${text}"`);
  }
  for (let word = 0;word < 4; word++) {
    let bits = 0;
    let valid = 0;
    for (let i = word * 4;i < word * 4 + 4; i++) {
      const at = uuidOffsets[i];
      const high = hexAt(text, at);
      const low = hexAt(text, at + 1);
      valid |= high | low;
      bits = bits << 8 | high << 4 | low;
    }
    if (valid < 0) {
      return fail10(`Expected a UUID, received "${text}"`);
    }
    uuidWord[word] = bits;
  }
};
var encodeUuid = (value) => {
  uuidWords(value);
  const bytes = new Uint8Array(16);
  writeInt32(bytes, 0, uuidWord[0]);
  writeInt32(bytes, 4, uuidWord[1]);
  writeInt32(bytes, 8, uuidWord[2]);
  writeInt32(bytes, 12, uuidWord[3]);
  return bytes;
};
var writeUuid = (sink, value) => {
  uuidWords(value);
  sink.int32(uuidWord[0]);
  sink.int32(uuidWord[1]);
  sink.int32(uuidWord[2]);
  sink.int32(uuidWord[3]);
};
var decodeUuid = (bytes, offset, size) => {
  requireSize(size, 16, "uuid");
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  const b4 = bytes[offset + 4];
  const b5 = bytes[offset + 5];
  const b6 = bytes[offset + 6];
  const b7 = bytes[offset + 7];
  const b8 = bytes[offset + 8];
  const b9 = bytes[offset + 9];
  const b10 = bytes[offset + 10];
  const b11 = bytes[offset + 11];
  const b12 = bytes[offset + 12];
  const b13 = bytes[offset + 13];
  const b14 = bytes[offset + 14];
  const b15 = bytes[offset + 15];
  return String.fromCharCode(hexHigh[b0], hexLow[b0], hexHigh[b1], hexLow[b1], hexHigh[b2], hexLow[b2], hexHigh[b3], hexLow[b3], 45, hexHigh[b4], hexLow[b4], hexHigh[b5], hexLow[b5], 45, hexHigh[b6], hexLow[b6], hexHigh[b7], hexLow[b7], 45, hexHigh[b8], hexLow[b8], hexHigh[b9], hexLow[b9], 45, hexHigh[b10], hexLow[b10], hexHigh[b11], hexLow[b11], hexHigh[b12], hexLow[b12], hexHigh[b13], hexLow[b13], hexHigh[b14], hexLow[b14], hexHigh[b15], hexLow[b15]);
};
var codecOf = (read, encode, write) => {
  const decode = (bytes) => read(bytes, 0, bytes.length);
  return write === undefined ? {
    encode,
    decode,
    read
  } : {
    encode,
    decode,
    read,
    write
  };
};
var takeScratch4 = () => {
  const bytes = new Uint8Array(4);
  bytes[0] = scratchBytes4[0];
  bytes[1] = scratchBytes4[1];
  bytes[2] = scratchBytes4[2];
  bytes[3] = scratchBytes4[3];
  return bytes;
};
var takeScratch8 = () => {
  const bytes = new Uint8Array(8);
  bytes[0] = scratchBytes8[0];
  bytes[1] = scratchBytes8[1];
  bytes[2] = scratchBytes8[2];
  bytes[3] = scratchBytes8[3];
  bytes[4] = scratchBytes8[4];
  bytes[5] = scratchBytes8[5];
  bytes[6] = scratchBytes8[6];
  bytes[7] = scratchBytes8[7];
  return bytes;
};
var utf8Codec = /* @__PURE__ */ codecOf(decodeUtf83, (value) => encodeUtf8(requireString(value, "text")), (sink, value) => sink.utf8(requireString(value, "text")));
var requireInt64 = (value, name) => {
  const big = requireBigInt(value, name);
  if (big < INT64_MIN || big > INT64_MAX)
    fail10(`${name} out of range: ${big}`);
  return big;
};
var MAX_TIME_MICROS = /* @__PURE__ */ BigInt(MAX_TIME_MICROS_NUMBER);
var timeValue = (value) => {
  const micros = requireBigInt(value, "time");
  if (micros < ZERO || micros > MAX_TIME_MICROS)
    fail10(`time out of range: ${micros}`);
  return micros;
};
var readTimeMicros = (bytes, offset) => {
  const high = readInt32(bytes, offset);
  const micros = high * 4294967296 + readUint32(bytes, offset + 4);
  if (high < 0 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail10(`timetz out of range: ${micros}`);
  }
  return micros;
};
var timestampHigh = 0;
var timestampLow = 0;
var timestampInt64 = (value) => {
  let ms;
  if (value instanceof Date) {
    ms = value.getTime();
    if (Number.isNaN(ms))
      fail10("timestamp cannot be an invalid Date");
  } else {
    ms = typeof value === "number" ? value : fail10("Expected a Date or number for timestamp");
    if (Number.isNaN(ms))
      fail10("timestamp cannot be NaN");
  }
  if (ms === Number.POSITIVE_INFINITY) {
    timestampHigh = INT32_MAX;
    timestampLow = -1;
  } else if (ms === Number.NEGATIVE_INFINITY) {
    timestampHigh = INT32_MIN;
    timestampLow = 0;
  } else {
    const unixMicros = Math.trunc(ms * 1000);
    if (!Number.isFinite(unixMicros)) {
      fail10(`timestamp out of range: ${ms}`);
    }
    const micros = unixMicros - PG_EPOCH_MICROS;
    if (micros > -MAX_EXACT && micros < MAX_EXACT) {
      timestampHigh = Math.floor(micros / 4294967296);
      timestampLow = micros - timestampHigh * 4294967296;
    } else {
      const exact = BigInt(unixMicros) - BigInt(PG_EPOCH_MICROS);
      if (exact < INT64_MIN || exact > INT64_MAX) {
        fail10(`timestamp out of range: ${ms}`);
      }
      scratchView8.setBigInt64(0, exact);
      timestampHigh = scratchView8.getInt32(0);
      timestampLow = scratchView8.getInt32(4);
    }
  }
};
var timestampCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "timestamp");
  const high = readInt32(bytes, offset);
  if (high >= -MAX_EXACT_HIGH && high < MAX_EXACT_HIGH) {
    const micros = high * 4294967296 + readUint32(bytes, offset + 4);
    return new Date((micros - micros % 1000) / 1000 + PG_EPOCH_MS);
  }
  stage8(bytes, offset);
  const micros = scratchView8.getBigInt64(0);
  if (micros === INT64_MAX || micros === INT64_MIN)
    return new Date(Number.NaN);
  return new Date(Number(micros / THOUSAND) + PG_EPOCH_MS);
}, (value) => {
  timestampInt64(value);
  const bytes = new Uint8Array(8);
  writeInt32(bytes, 0, timestampHigh);
  writeInt32(bytes, 4, timestampLow);
  return bytes;
}, (sink, value) => {
  timestampInt64(value);
  sink.int32(timestampHigh);
  sink.int32(timestampLow);
});
var dateDays = (value) => {
  const text = requireString(value, "date");
  if (text === "infinity")
    return INT32_MAX;
  if (text === "-infinity")
    return INT32_MIN;
  const days = parseDate(text) - PG_EPOCH_DAYS;
  if (days <= INT32_MIN || days >= INT32_MAX) {
    return fail10(`date out of range: "${text}"`);
  }
  return days;
};
var dateCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "date");
  const days = readInt32(bytes, offset);
  if (days === INT32_MAX)
    return "infinity";
  if (days === INT32_MIN)
    return "-infinity";
  return formatDate2(days + PG_EPOCH_DAYS);
}, (value) => {
  const bytes = new Uint8Array(4);
  writeInt32(bytes, 0, dateDays(value));
  return bytes;
}, (sink, value) => sink.int32(dateDays(value)));
var timetzCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 12, "timetz");
  const zone = readInt32(bytes, offset + 8);
  if (zone <= -TZDISP_LIMIT_SECONDS || zone >= TZDISP_LIMIT_SECONDS) {
    return fail10(`timetz time zone displacement out of range: ${zone}`);
  }
  return formatTimeOfDay(readTimeMicros(bytes, offset)) + formatZone(-zone);
}, (value) => {
  const text = requireString(value, "timetz");
  const split = Math.max(text.lastIndexOf("+"), text.lastIndexOf("-"), text.lastIndexOf("Z"));
  if (split <= 0) {
    return fail10(`Expected a timetz with a zone offset, received "${text}"`);
  }
  const bytes = new Uint8Array(12);
  writeInt64(bytes, 0, parseTimeOfDay(text.slice(0, split)));
  writeInt32(bytes, 8, -parseZone(text.slice(split)));
  return bytes;
});
var jsonCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => JSON.parse(decodeUtf83(bytes, offset, size)), (value) => {
  const text = JSON.stringify(value);
  if (text === undefined)
    return fail10("Value cannot be serialised as JSON");
  return encodeUtf8(text);
}, (sink, value) => {
  const text = JSON.stringify(value);
  if (text === undefined)
    return fail10("Value cannot be serialised as JSON");
  sink.utf8(text);
});
var jsonbCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  if (size === 0 || bytes[offset] !== 1) {
    return fail10("Unsupported jsonb version byte");
  }
  return JSON.parse(decodeUtf83(bytes, offset + 1, size - 1));
}, (value) => {
  const text = JSON.stringify(value);
  if (text === undefined)
    return fail10("Value cannot be serialised as JSON");
  const bytes = encodeUtf8Prefixed(text, 1);
  bytes[0] = 1;
  return bytes;
}, (sink, value) => {
  const text = JSON.stringify(value);
  if (text === undefined)
    return fail10("Value cannot be serialised as JSON");
  sink.uint8(1);
  sink.utf8(text);
});
var oidCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "oid");
  return readUint32(bytes, offset);
}, (value) => {
  const num = requireInteger(value, "oid", 0, 4294967295);
  const bytes = new Uint8Array(4);
  bytes[0] = num >>> 24;
  bytes[1] = num >>> 16;
  bytes[2] = num >>> 8;
  bytes[3] = num;
  return bytes;
}, (sink, value) => sink.int32(requireInteger(value, "oid", 0, 4294967295)));
var intervalValue = (value) => {
  if (typeof value !== "object" || value === null)
    return fail10("Expected an object for interval");
  const interval = value;
  const months = requireInteger(interval.months, "interval months", INT32_MIN, INT32_MAX);
  const days = requireInteger(interval.days, "interval days", INT32_MIN, INT32_MAX);
  const microseconds = requireInt64(interval.microseconds, "interval microseconds");
  return {
    months,
    days,
    microseconds
  };
};
var intervalCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 16, "interval");
  stage8(bytes, offset);
  return {
    months: readInt32(bytes, offset + 12),
    days: readInt32(bytes, offset + 8),
    microseconds: scratchView8.getBigInt64(0)
  };
}, (value) => {
  const interval = intervalValue(value);
  const bytes = new Uint8Array(16);
  scratchView8.setBigInt64(0, interval.microseconds);
  bytes.set(scratchBytes8);
  writeInt32(bytes, 8, interval.days);
  writeInt32(bytes, 12, interval.months);
  return bytes;
}, (sink, value) => {
  const interval = intervalValue(value);
  sink.bigInt64(interval.microseconds);
  sink.int32(interval.days);
  sink.int32(interval.months);
});
var builtinScalars = /* @__PURE__ */ new Map([[OID.bool, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 1, "bool");
  return bytes[offset] !== 0;
}, (value) => {
  if (typeof value !== "boolean")
    fail10("Expected a boolean for bool");
  const bytes = new Uint8Array(1);
  bytes[0] = value ? 1 : 0;
  return bytes;
}, (sink, value) => {
  if (typeof value !== "boolean")
    fail10("Expected a boolean for bool");
  sink.uint8(value ? 1 : 0);
})], [OID.bytea, /* @__PURE__ */ codecOf(region, (value) => value instanceof Uint8Array ? value.slice() : fail10("Expected a Uint8Array for bytea"), (sink, value) => value instanceof Uint8Array ? sink.raw(value) : fail10("Expected a Uint8Array for bytea"))], [OID.int2, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 2, "int2");
  return (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
}, (value) => {
  const num = requireInteger(value, "int2", -32768, 32767);
  const bytes = new Uint8Array(2);
  bytes[0] = num >>> 8;
  bytes[1] = num;
  return bytes;
}, (sink, value) => sink.int16(requireInteger(value, "int2", -32768, 32767)))], [OID.int4, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "int4");
  return readInt32(bytes, offset);
}, (value) => {
  const num = requireInteger(value, "int4", INT32_MIN, INT32_MAX);
  const bytes = new Uint8Array(4);
  bytes[0] = num >>> 24;
  bytes[1] = num >>> 16;
  bytes[2] = num >>> 8;
  bytes[3] = num;
  return bytes;
}, (sink, value) => sink.int32(requireInteger(value, "int4", INT32_MIN, INT32_MAX)))], [OID.oid, oidCodec], [OID.regclass, oidCodec], [OID.int8, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "int8");
  stage8(bytes, offset);
  return scratchView8.getBigInt64(0);
}, (value) => {
  scratchView8.setBigInt64(0, requireInt64(value, "int8"));
  return takeScratch8();
}, (sink, value) => sink.bigInt64(requireInt64(value, "int8")))], [OID.float4, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "float4");
  scratchView4.setInt32(0, readInt32(bytes, offset));
  return scratchView4.getFloat32(0);
}, (value) => {
  scratchView4.setFloat32(0, requireNumber(value, "float4"));
  return takeScratch4();
}, (sink, value) => sink.float32(requireNumber(value, "float4")))], [OID.float8, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "float8");
  stage8(bytes, offset);
  return scratchView8.getFloat64(0);
}, (value) => {
  scratchView8.setFloat64(0, requireNumber(value, "float8"));
  return takeScratch8();
}, (sink, value) => sink.float64(requireNumber(value, "float8")))], [OID.time, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "time");
  stage8(bytes, offset);
  return scratchView8.getBigInt64(0);
}, (value) => {
  scratchView8.setBigInt64(0, timeValue(value));
  return takeScratch8();
}, (sink, value) => sink.bigInt64(timeValue(value)))], [OID.numeric, /* @__PURE__ */ codecOf(decodeNumeric, encodeNumeric)], [OID.text, utf8Codec], [OID.varchar, utf8Codec], [OID.bpchar, utf8Codec], [OID.name, utf8Codec], [OID.json, jsonCodec], [OID.jsonb, jsonbCodec], [OID.uuid, /* @__PURE__ */ codecOf(decodeUuid, encodeUuid, writeUuid)], [OID.inet, /* @__PURE__ */ codecOf(decodeInet, (value) => encodeInet(value, false))], [OID.cidr, /* @__PURE__ */ codecOf(decodeInet, (value) => encodeInet(value, true))], [OID.date, dateCodec], [OID.timetz, timetzCodec], [OID.timestamp, timestampCodec], [OID.timestamptz, timestampCodec], [OID.interval, intervalCodec]]);
var makeArrayCodec = (elementOid, lookup) => codecOf((bytes, offset, size) => decodeArray(bytes, offset, size, elementOid, lookup), (value) => encodeArray(value, elementOid, lookup), (sink, value) => writeArray(sink, value, elementOid, lookup));
var builtins = /* @__PURE__ */ new Map(builtinScalars);
var codecs = /* @__PURE__ */ new Map(builtins);
var tableSize = 4096;
var table = /* @__PURE__ */ new Array(tableSize);
var lookup2 = (oid) => oid >= 0 && oid < tableSize ? table[oid] : codecs.get(oid);
for (const [arrayOid, elementOid] of arrayToElement) {
  const codec = /* @__PURE__ */ makeArrayCodec(elementOid, lookup2);
  builtins.set(arrayOid, codec);
  codecs.set(arrayOid, codec);
}
for (const [oid, codec] of codecs)
  table[oid] = codec;
var registryStates = /* @__PURE__ */ new WeakMap;
var getRegistryState = (registry) => {
  const state = registryStates.get(registry);
  if (state === undefined)
    return fail10("Invalid PgTypes Registry");
  return state;
};
var lookupFor = (registry) => registry === undefined ? lookup2 : getRegistryState(registry).lookup;
var encodeArray = (value, elementOid, lookup) => {
  if (!Array.isArray(value)) {
    return fail10("Expected an array");
  }
  const codec = lookup(elementOid);
  if (codec === undefined)
    return fail10(`No codec registered for OID ${elementOid}`);
  const count = value.length;
  const elements = new Array(count);
  let hasNull = false;
  let payloadSize = 0;
  for (let i = 0;i < count; i++) {
    const element = value[i];
    if (element === null) {
      elements[i] = null;
      hasNull = true;
      payloadSize += 4;
    } else {
      const encoded = codec.encode(element);
      elements[i] = encoded;
      payloadSize += 4 + encoded.length;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  const bytes = new Uint8Array(12 + dimensions * 8 + payloadSize);
  writeInt32(bytes, 0, dimensions);
  writeInt32(bytes, 4, hasNull ? 1 : 0);
  writeInt32(bytes, 8, elementOid);
  let offset = 12;
  if (dimensions === 1) {
    writeInt32(bytes, offset, count);
    writeInt32(bytes, offset + 4, 1);
    offset += 8;
  }
  for (let i = 0;i < count; i++) {
    const element = elements[i];
    if (element === null) {
      writeInt32(bytes, offset, -1);
      offset += 4;
    } else {
      writeInt32(bytes, offset, element.length);
      bytes.set(element, offset + 4);
      offset += 4 + element.length;
    }
  }
  return bytes;
};
var writeArray = (sink, value, elementOid, lookup) => {
  if (!Array.isArray(value)) {
    return fail10("Expected an array");
  }
  const count = value.length;
  let hasNull = false;
  for (let i = 0;i < count; i++) {
    if (value[i] === null) {
      hasNull = true;
      break;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  sink.int32(dimensions);
  sink.int32(hasNull ? 1 : 0);
  sink.int32(elementOid);
  if (dimensions === 1) {
    sink.int32(count);
    sink.int32(1);
  }
  const write = lookup(elementOid)?.write;
  for (let i = 0;i < count; i++) {
    const element = value[i];
    if (element === null) {
      sink.int32(-1);
    } else {
      const token = sink.beginLength();
      if (write === undefined)
        writeValue(sink, element, elementOid, lookup);
      else
        write(sink, element);
      sink.endLength(token);
    }
  }
};
var decodeArray = (bytes, start, size, elementOid, lookup) => {
  if (size < 12)
    return fail10("Truncated array value");
  const dimensions = readInt32(bytes, start);
  const wireElementOid = readUint32(bytes, start + 8);
  if (wireElementOid !== elementOid) {
    return fail10(`Array element OID ${wireElementOid} does not match expected OID ${elementOid}`);
  }
  if (dimensions === 0) {
    if (size !== 12)
      return fail10("Zero-dimensional array has trailing bytes");
    return [];
  }
  if (dimensions !== 1) {
    return fail10(`Only 1-dimensional arrays are supported, received ${dimensions} dimensions`);
  }
  if (size < 20)
    return fail10("Truncated array value");
  const length = readInt32(bytes, start + 12);
  if (length < 0)
    return fail10(`Invalid array length: ${length}`);
  const lowerBound = readInt32(bytes, start + 16);
  if (lowerBound !== 1)
    return fail10(`Only arrays with a lower bound of 1 are supported, received ${lowerBound}`);
  const codec = lookup(elementOid);
  const read = codec?.read;
  const values = new Array(length);
  const limit = start + size;
  let offset = start + 20;
  for (let i = 0;i < length; i++) {
    if (offset + 4 > limit)
      return fail10("Truncated array element");
    const elementSize = readInt32(bytes, offset);
    offset += 4;
    if (elementSize < -1)
      return fail10(`Invalid array element length: ${elementSize}`);
    if (elementSize === -1) {
      values[i] = null;
    } else {
      if (offset + elementSize > limit)
        return fail10("Truncated array element");
      values[i] = read !== undefined ? read(bytes, offset, elementSize) : codec === undefined ? region(bytes, offset, elementSize) : codec.decode(region(bytes, offset, elementSize));
      offset += elementSize;
    }
  }
  if (offset !== limit)
    return fail10("Array value has trailing bytes");
  return values;
};
var makeFieldReader = (columns, registry) => result3(() => {
  const lookup = lookupFor(registry);
  const codecs = columns.map((column, index) => {
    if (column.format !== 1) {
      return fail10(`Only the binary format is supported, column ${index} has format ${column.format}`);
    }
    return lookup(column.dataTypeOid);
  });
  return (bytes, offset, size, column) => {
    if (size < 0)
      return null;
    const codec = codecs[column];
    if (codec === undefined) {
      return decodeUnregistered(bytes, offset, size, columns[column].dataTypeOid, columns[column], column);
    }
    const read = codec.read;
    return read === undefined ? codec.decode(bytes.subarray(offset, offset + size)) : read(bytes, offset, size);
  };
});
var ParameterTypeId = "~@effect/sql-pg/PgTypes/Parameter";
var isParameter = (value) => typeof value === "object" && value !== null && value[ParameterTypeId] === ParameterTypeId;
var writeValue = (sink, value, oid, lookup) => {
  const codec = lookup(oid);
  if (codec === undefined)
    return fail10(`No codec registered for OID ${oid}`);
  if (codec.write === undefined)
    sink.raw(codec.encode(value));
  else
    codec.write(sink, value);
};
var isTextFormat = (parameter) => parameter.oid === 0;
var writeParameterUnsafe = (sink, parameter, lookup) => parameter.value === null ? sink.sqlNull() : parameter.oid === 0 ? sink.utf8(String(parameter.value)) : writeValue(sink, parameter.value, parameter.oid, lookup);
var writeParameter = (sink, parameter, registry) => {
  try {
    writeParameterUnsafe(sink, parameter, lookupFor(registry));
    return void_;
  } catch (error) {
    if (error instanceof CodecError)
      return fail2(error);
    throw error;
  }
};
var valueWriterUnsafe2 = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
Object.defineProperty(writeParameter, valueWriterUnsafe2, {
  value: (sink, parameter) => writeParameterUnsafe(sink, parameter, lookup2)
});
var makeParameter = (oid, value) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid,
  value
});
var parameter2 = (oid) => (value) => makeParameter(oid, value);
var bool = /* @__PURE__ */ parameter2(OID.bool);
var int2 = /* @__PURE__ */ parameter2(OID.int2);
var int4 = /* @__PURE__ */ parameter2(OID.int4);
var int8 = /* @__PURE__ */ parameter2(OID.int8);
var oid = /* @__PURE__ */ parameter2(OID.oid);
var float4 = /* @__PURE__ */ parameter2(OID.float4);
var float8 = /* @__PURE__ */ parameter2(OID.float8);
var numeric = /* @__PURE__ */ parameter2(OID.numeric);
var text = /* @__PURE__ */ parameter2(OID.text);
var varchar = /* @__PURE__ */ parameter2(OID.varchar);
var bpchar = /* @__PURE__ */ parameter2(OID.bpchar);
var name = /* @__PURE__ */ parameter2(OID.name);
var bytea = /* @__PURE__ */ parameter2(OID.bytea);
var json = /* @__PURE__ */ parameter2(OID.json);
var jsonb = /* @__PURE__ */ parameter2(OID.jsonb);
var uuid = /* @__PURE__ */ parameter2(OID.uuid);
var inet = /* @__PURE__ */ parameter2(OID.inet);
var cidr = /* @__PURE__ */ parameter2(OID.cidr);
var date = /* @__PURE__ */ parameter2(OID.date);
var time = /* @__PURE__ */ parameter2(OID.time);
var timetz = /* @__PURE__ */ parameter2(OID.timetz);
var timestamp = /* @__PURE__ */ parameter2(OID.timestamp);
var timestamptz = /* @__PURE__ */ parameter2(OID.timestamptz);
var interval = /* @__PURE__ */ parameter2(OID.interval);

// ../../node_modules/@effect/sql-pg/dist/PgConnection.js
var TypeId28 = "~@effect/sql-pg/PgConnection";
var preparedCacheFor = (config) => {
  if (config.prepare === false)
    return;
  const max = config.preparedStatementCacheSize ?? defaultPreparedStatements;
  return max > 0 ? new PreparedCache(max) : undefined;
};
var make21 = (options) => flatMap3(resolveConfig(options), (config) => acquireRelease2(gen2(function* () {
  const password = yield* resolve3(config.password);
  const session = yield* connect3(config, password);
  return new PgConnectionImpl(options, config, session, options.types);
}), (connection) => sync2(() => connection.closeUnsafe()), {
  interruptible: true
}).pipe(timeoutOrElse2({
  duration: config.connectTimeout,
  orElse: () => fail6(new SqlError({
    reason: new ConnectionError({
      cause: new Error("Connection timed out"),
      message: "PgConnection: Connection timed out",
      operation: "connect"
    })
  }))
})));
var abortDrainTimeoutMillis = 5000;
var abortDrainGraceMillis = 10;
var queryCanceledCode = "57014";
var cancelRequestTimeoutMillis = 5000;
var terminateTimeoutMillis = 1000;
var unlistenTimeoutMillis = 5000;
var maxPipelineDepth = 128;
var streamPauseThreshold = 512;

class PgConnectionImpl {
  [TypeId28] = TypeId28;
  config;
  processId;
  session;
  registry;
  bindEncoder;
  prepared;
  resolved;
  multiplex;
  wire = /* @__PURE__ */ makeUnsafe5(1);
  owner = /* @__PURE__ */ makeUnsafe5(1);
  pinned = false;
  consumer;
  deadWith;
  closed = false;
  cancelPending = false;
  transactionStatus = "I";
  channels = /* @__PURE__ */ new Map;
  retireHooks = /* @__PURE__ */ new Set;
  pipelinePending = [];
  pipelineInFlight = [];
  pipelineHead = 0;
  pipelineFlushScheduled = false;
  pipelineIdleWaiters = /* @__PURE__ */ new Set;
  [internalsKey];
  constructor(config, resolved, session, registry) {
    this.config = config;
    this.resolved = resolved;
    this.session = session;
    this.processId = session.processId;
    this.registry = registry;
    this.bindEncoder = makeBindEncoder2(registry);
    this.prepared = preparedCacheFor(config);
    this.multiplex = config.multiplex ?? false;
    this[internalsKey] = {
      base: this,
      deadError: () => this.deadWith,
      retireHooks: this.retireHooks
    };
    session.parser.onFieldError = this.onFieldError;
    session.socket.on("data", this.onData);
    session.socket.on("error", this.onSocketError);
    session.socket.on("close", this.onSocketClose);
  }
  onData = (chunk) => {
    try {
      this.session.parser.pushEach(chunk, this.dispatch);
    } catch (cause) {
      return this.fatal(cause instanceof ParseError ? connectionQueryError(cause, "PgConnection: Failed to parse server messages") : queryError(cause, "PgConnection: Failed to decode row"));
    }
    if (this.deadWith === undefined)
      this.consumer?.onBatchEnd?.();
  };
  onFieldError = (cause) => {
    if (this.deadWith !== undefined)
      return;
    const error = queryError(cause, "PgConnection: Failed to decode row");
    if (this.consumer !== undefined)
      return this.consumer.onDecodeFailure(error);
    this.fatal(error);
  };
  onSocketError = (cause) => this.fatal(connectionQueryError(cause, "PgConnection: Socket error"));
  onSocketClose = () => this.fatal(connectionQueryError(new Error("Connection closed"), "PgConnection: Connection closed"));
  dispatch = (message) => {
    if (this.deadWith !== undefined)
      return;
    switch (message._tag) {
      case "ErrorResponse":
        if (message.fields.code === queryCanceledCode)
          this.cancelPending = false;
        break;
      case "ReadyForQuery":
        this.transactionStatus = message.status;
        if (this.cancelPending) {
          this.cancelPending = false;
          this.retire();
        }
        break;
      case "NotificationResponse": {
        const queues = this.channels.get(message.channel);
        if (queues !== undefined) {
          const notification = {
            processId: message.pid,
            channel: message.channel,
            payload: message.payload
          };
          for (const queue of queues)
            offerUnsafe(queue, notification);
        }
        return;
      }
      case "ParameterStatus":
      case "NoticeResponse":
        return;
    }
    if (this.consumer !== undefined)
      return this.consumer.onMessage(message);
    if (message._tag === "ErrorResponse") {
      return this.fatal(new SqlError({
        reason: classifyFields(message.fields, "PgConnection: The server reported an error", "query")
      }));
    }
    this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} while idle`), `PgConnection: Unexpected ${message._tag} while idle`));
  };
  fatal(error, destroySocket = true) {
    if (this.deadWith !== undefined)
      return;
    this.deadWith = error;
    if (destroySocket)
      this.session.socket.destroy();
    const consumer = this.consumer;
    this.consumer = undefined;
    this.retire();
    consumer?.onFatal(error);
    const sets = Array.from(this.channels.values());
    this.channels.clear();
    const cause = this.closed ? interrupt2() : fail4(error);
    for (const set of sets) {
      for (const queue of set)
        failCauseUnsafe(queue, cause);
    }
  }
  retire() {
    if (this.closed)
      return;
    for (const hook of this.retireHooks)
      hook();
  }
  closeUnsafe() {
    this.closed = true;
    const socket = this.session.socket;
    let destroySocket = true;
    if (this.deadWith === undefined && socket.writable) {
      try {
        const timeout = setTimeout(() => socket.destroy(), terminateTimeoutMillis);
        timeout.unref();
        socket.once("finish", () => socket.destroy());
        socket.once("close", () => clearTimeout(timeout));
        socket.end(encodeTerminate());
        destroySocket = false;
      } catch {}
    }
    this.fatal(new SqlError({
      reason: new ConnectionError({
        cause: new Error("Connection is closed"),
        message: "PgConnection: Connection is closed",
        operation: "query"
      })
    }), destroySocket);
    socket.off("data", this.onData);
    socket.off("error", this.onSocketError);
    socket.off("close", this.onSocketClose);
    this.retireHooks.clear();
  }
  encodeQuery = (sql, params, cache) => encodeQuery(sql, params, this.registry, this.bindEncoder, cache);
  pipelineConsumer = {
    onMessage: (message) => {
      const entry = this.pipelineInFlight[this.pipelineHead];
      if (entry === undefined) {
        return this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} without an in-flight query`), `PgConnection: Unexpected ${message._tag} without an in-flight query`));
      }
      entry.machine.onMessage(message);
    },
    onDecodeFailure: (error) => {
      const entry = this.pipelineInFlight[this.pipelineHead];
      if (entry === undefined)
        return this.fatal(error);
      entry.machine.onDecodeFailure(error);
    },
    onBatchEnd: () => this.flushPipeline(),
    onFatal: (error) => {
      const entries = [...this.pipelineInFlight.slice(this.pipelineHead), ...this.pipelinePending];
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
      this.pipelinePending.length = 0;
      this.pipelineFlushScheduled = false;
      for (const entry of entries) {
        if (!entry.abandoned)
          doneUnsafe(entry.deferred, fail6(error));
      }
      this.notifyPipelineIdle();
    }
  };
  pipelineDepth = () => this.pipelineInFlight.length - this.pipelineHead;
  pipelineIsIdle = () => this.pipelineDepth() === 0 && this.pipelinePending.length === 0;
  notifyPipelineIdle = () => {
    if (!this.pipelineIsIdle())
      return;
    this.consumer = undefined;
    this.session.parser.readField = undefined;
    const waiters = Array.from(this.pipelineIdleWaiters);
    this.pipelineIdleWaiters.clear();
    for (const waiter of waiters)
      waiter();
  };
  waitPipelineIdle = /* @__PURE__ */ callback2((resume) => {
    if (this.pipelineIsIdle())
      return resume(void_4);
    const waiter = () => resume(void_4);
    this.pipelineIdleWaiters.add(waiter);
    return sync2(() => this.pipelineIdleWaiters.delete(waiter));
  });
  finishPipelineEntry = (entry, result) => {
    if (this.pipelineInFlight[this.pipelineHead] !== entry) {
      return this.fatal(connectionQueryError(new Error("A pipelined query completed out of order"), "PgConnection: A pipelined query completed out of order"));
    }
    this.pipelineHead++;
    this.session.parser.readField = this.pipelineInFlight[this.pipelineHead]?.machine.readField;
    if (!entry.abandoned)
      doneUnsafe(entry.deferred, result);
    if (this.pipelineHead === this.pipelineInFlight.length) {
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
    }
  };
  flushPipeline = () => {
    this.pipelineFlushScheduled = false;
    if (this.deadWith !== undefined)
      return;
    let capacity = maxPipelineDepth - this.pipelineDepth();
    if (capacity <= 0)
      return;
    const wasEmpty = this.pipelineDepth() === 0;
    const batch = [];
    let index = 0;
    while (capacity > 0 && index < this.pipelinePending.length) {
      const entry = this.pipelinePending[index++];
      if (entry.abandoned) {
        if (entry.plan.parses && entry.plan.prepared !== undefined) {
          entry.plan.prepared.parsing = false;
        }
        continue;
      }
      batch.push(entry);
      this.pipelineInFlight.push(entry);
      capacity--;
    }
    this.pipelinePending.splice(0, index);
    if (batch.length === 0) {
      this.notifyPipelineIdle();
      return;
    }
    if (wasEmpty)
      this.session.parser.readField = batch[0].machine.readField;
    const frame = batch.length === 1 ? batch[0].plan.frame : concat(batch.map((entry) => entry.plan.frame));
    try {
      this.session.socket.write(frame);
    } catch (cause) {
      this.fatal(connectionQueryError(cause, "PgConnection: Failed to write query batch"));
    }
  };
  schedulePipelineFlush = () => {
    if (this.pipelineFlushScheduled || this.pipelineDepth() >= maxPipelineDepth)
      return;
    this.pipelineFlushScheduled = true;
    queueMicrotask(this.flushPipeline);
  };
  pipelineCycle = (sql, params, wantRows, cache) => flatMap3(this.owner.withPermit(suspend2(() => {
    if (this.deadWith !== undefined)
      return fail6(this.deadWith);
    let plan;
    try {
      plan = this.encodeQuery(sql, params, cache);
    } catch (cause) {
      return fail6(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const deferred = makeUnsafe2();
    let entry;
    const machine = new QueryMachine(this, plan, wantRows, (result) => this.finishPipelineEntry(entry, result));
    entry = {
      plan,
      deferred,
      machine,
      abandoned: false
    };
    this.pipelinePending.push(entry);
    this.consumer = this.pipelineConsumer;
    this.schedulePipelineFlush();
    return succeed6(entry);
  })), (entry) => {
    const awaited = _await(entry.deferred).pipe(onInterrupt2(() => sync2(() => {
      entry.abandoned = true;
    })));
    if (cache === undefined || entry.plan.parses)
      return awaited;
    return retryStale(entry.plan, cache, awaited, () => this.pipelineCycle(sql, params, wantRows, undefined));
  });
  cycleOwned = (sql, params, wantRows, cache) => suspend2(() => this.attempt(sql, params, wantRows, cache));
  attempt = (sql, params, wantRows, cache) => {
    if (this.deadWith !== undefined)
      return fail6(this.deadWith);
    let plan;
    try {
      plan = this.encodeQuery(sql, params, cache);
    } catch (cause) {
      return fail6(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const run = runQuery(this, plan, wantRows);
    if (cache === undefined || plan.parses)
      return run;
    return retryStale(plan, cache, run, () => this.attempt(sql, params, wantRows, undefined));
  };
  cancel = /* @__PURE__ */ suspend2(() => {
    if (this.deadWith !== undefined)
      return void_4;
    this.cancelPending = true;
    if (this.consumer === undefined)
      this.retire();
    return sendCancelRequest(this.resolved, this.session);
  });
  pin = /* @__PURE__ */ suspend2(() => {
    const reserve = this[internalsKey].reserve;
    return reserve === undefined ? this.pinExclusive : andThen2(reserve, this.pinExclusive);
  });
  pinExclusive = /* @__PURE__ */ acquireRelease2(/* @__PURE__ */ uninterruptibleMask2((restore) => flatMap3(restore(this.owner.take(1)), () => map6(onInterrupt2(restore(this.waitPipelineIdle), () => this.owner.release(1)), () => {
    this.pinned = true;
    return new PinnedPgConnection(this);
  }))), (view) => flatMap3(suspend2(() => {
    view.released = true;
    this.pinned = false;
    return view.unlistening > 0 ? as2(this.wire.take(1), true) : this.wire.takeIfAvailable(1);
  }), (idle) => {
    if (!idle || view.listeners > 0) {
      this.fatal(connectionQueryError(new Error("Pinned connection released with work outstanding"), "PgConnection: Pinned connection released with work outstanding"));
    } else if (view.startedIdle && this.transactionStatus === "E") {
      this.fatal(connectionQueryError(new Error("Pinned connection released in an aborted transaction"), "PgConnection: Pinned connection released in an aborted transaction"));
    }
    return idle ? andThen2(this.wire.release(1), this.owner.release(1)) : this.owner.release(1);
  }), {
    interruptible: true
  });
  run = (sql, params, wantRows, prepare) => {
    const cache = prepare ? this.prepared : undefined;
    return this.multiplex ? this.pipelineCycle(sql, params, wantRows, cache) : this.owner.withPermit(this.cycleOwned(sql, params, wantRows, cache));
  };
  query = (sql, params, prepare = true) => map6(this.run(sql, params ?? emptyParams, true, prepare), takeResult);
  queryValues = (sql, params, prepare = true) => map6(this.run(sql, params ?? emptyParams, false, prepare), takeValues);
  stream = (sql, params) => streamRows(this, this.pin, sql, params ?? emptyParams);
  listen = (channel) => listenChannel(this, this.pin, channel);
  interrupt = /* @__PURE__ */ suspend2(() => this.multiplex && !this.pinned ? void_4 : this.cancel);
}

class PinnedPgConnection {
  [TypeId28] = TypeId28;
  base;
  [internalsKey];
  pin;
  released = false;
  listeners = 0;
  unlistening = 0;
  startedIdle;
  constructor(base) {
    this.base = base;
    this[internalsKey] = base[internalsKey];
    this.pin = succeed6(this);
    this.startedIdle = base.transactionStatus === "I";
  }
  cycle(sql, params, wantRows, prepare) {
    return this.base.wire.withPermit(suspend2(() => this.released ? fail6(pinReleasedError()) : this.base.cycleOwned(sql, params, wantRows, prepare ? this.base.prepared : undefined)));
  }
  interrupt = /* @__PURE__ */ suspend2(() => this.released ? void_4 : this.base.cancel);
  get config() {
    return this.base.config;
  }
  get processId() {
    return this.base.processId;
  }
  query = (sql, params, prepare = true) => map6(this.cycle(sql, params ?? emptyParams, true, prepare), takeResult);
  queryValues = (sql, params, prepare = true) => map6(this.cycle(sql, params ?? emptyParams, false, prepare), takeValues);
  stream = (sql, params) => streamRows(this.base, this.pin, sql, params ?? emptyParams);
  listen = (channel) => listenChannel(this.base, this.pin, channel);
}
var INT32_MIN2 = -2147483648;
var INT32_MAX2 = 2147483647;
var inferredParameter = (oid, value) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid,
  value
});
var inferScalar = (value) => {
  if (isParameter(value))
    return value;
  if (value === null || value === undefined)
    return inferredParameter(0, null);
  switch (typeof value) {
    case "boolean":
      return inferredParameter(OID.bool, value);
    case "bigint":
      return inferredParameter(OID.int8, value);
    case "number":
      if (Number.isInteger(value)) {
        if (value >= INT32_MIN2 && value <= INT32_MAX2) {
          return inferredParameter(OID.int4, value);
        }
        if (Number.isSafeInteger(value)) {
          return inferredParameter(OID.int8, BigInt(value));
        }
      }
      return inferredParameter(OID.float8, value);
    case "string":
      return inferredParameter(0, value);
  }
  if (value instanceof Date)
    return inferredParameter(OID.timestamptz, value);
  if (value instanceof Uint8Array)
    return inferredParameter(OID.bytea, value);
  if (value instanceof Int8Array) {
    return inferredParameter(OID.bytea, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new CodecError({
    message: `Cannot infer a PostgreSQL type for ${String(value)}`
  });
};
var inferParameter = (value, registry) => {
  if (!Array.isArray(value))
    return inferScalar(value);
  if (value.length === 0) {
    return inferredParameter(0, "{}");
  }
  let elementOid;
  const values = new Array(value.length);
  for (let index = 0;index < value.length; index++) {
    const element = value[index];
    if (Array.isArray(element)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    const parameter = inferScalar(element);
    let oid = parameter.oid;
    if (oid === 0) {
      if (parameter.value === null) {
        values[index] = null;
        continue;
      }
      oid = OID.text;
    }
    if (Array.isArray(parameter.value)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    if (elementOid === undefined)
      elementOid = oid;
    else if (elementOid !== oid) {
      throw new CodecError({
        message: "Array parameter elements must have the same inferred OID"
      });
    }
    values[index] = parameter.value;
  }
  if (elementOid === undefined) {
    throw new CodecError({
      message: "Cannot infer the type of an array containing only null values"
    });
  }
  const arrayOid = arrayOidFor(elementOid, registry);
  if (arrayOid === undefined) {
    throw new CodecError({
      message: `No array type known for element OID ${elementOid}`
    });
  }
  return inferredParameter(arrayOid, values);
};
var concat = (chunks) => {
  let length = 0;
  for (let index = 0;index < chunks.length; index++)
    length += chunks[index].length;
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  for (let index = 0;index < chunks.length; index++) {
    output.set(chunks[index], offset);
    offset += chunks[index].length;
  }
  return output;
};
var emptyParams = [];
var takeResult = (output) => output.result;
var takeValues = (output) => output.values;
var describeExecuteSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeDescribe({
  target: "portal",
  name: ""
}), /* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var executeSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var defaultPreparedStatements = 100;
var encodeUnnamed = (sql, parameters, parameterTypes, encodeBind) => {
  const parse = encodeParse({
    name: "",
    query: sql,
    parameterTypes
  });
  if (isFailure2(parse))
    throw parse.failure;
  const bind = encodeBind({
    portal: "",
    statement: "",
    parameters
  });
  if (isFailure2(bind))
    throw bind.failure;
  return {
    frame: concat([parse.success, bind.success, describeExecuteSync]),
    closes: 0,
    parses: true,
    describes: true,
    prepared: undefined,
    description: undefined,
    stale: false
  };
};
var encodeQuery = (sql, params, registry, encodeBind, cache) => {
  const count = params.length;
  const parameters = new Array(count);
  const parameterTypes = new Array(count);
  for (let index = 0;index < count; index++) {
    const parameter = inferParameter(params[index], registry);
    parameters[index] = parameter;
    parameterTypes[index] = parameter.oid;
  }
  if (cache === undefined) {
    return encodeUnnamed(sql, parameters, parameterTypes, encodeBind);
  }
  const prepared = cache.get(sql, parameterTypes);
  if (!prepared.ready && prepared.parsing) {
    return encodeUnnamed(sql, parameters, parameterTypes, encodeBind);
  }
  const bind = encodeBind({
    portal: "",
    statement: prepared.name,
    parameters
  });
  if (isFailure2(bind))
    throw bind.failure;
  const parse = prepared.ready ? undefined : encodeParse({
    name: prepared.name,
    query: sql,
    parameterTypes
  });
  if (parse !== undefined && isFailure2(parse))
    throw parse.failure;
  const closeFrames = cache.takeCloses();
  if (parse === undefined) {
    return {
      frame: closeFrames === undefined ? concat([bind.success, executeSync]) : concat([closeFrames.frames, bind.success, executeSync]),
      closes: closeFrames?.count ?? 0,
      parses: false,
      describes: false,
      prepared,
      description: prepared.description,
      stale: false
    };
  }
  prepared.parsing = true;
  return {
    frame: closeFrames === undefined ? concat([parse.success, bind.success, describeExecuteSync]) : concat([closeFrames.frames, parse.success, bind.success, describeExecuteSync]),
    closes: closeFrames?.count ?? 0,
    parses: true,
    describes: true,
    prepared,
    description: undefined,
    stale: false
  };
};

class PreparedCache {
  max;
  statements = /* @__PURE__ */ new Map;
  namespace = /* @__PURE__ */ randomBytes(8).toString("hex");
  closes;
  counter = 0;
  constructor(max) {
    this.max = max;
  }
  get(sql, parameterTypes) {
    const key = parameterTypes.length === 0 ? sql : `${sql}\x00${parameterTypes.join(",")}`;
    const found = this.statements.get(key);
    if (found !== undefined) {
      this.statements.delete(key);
      this.statements.set(key, found);
      this.trim(found);
      return found;
    }
    const prepared = {
      name: `effect_${this.namespace}_${++this.counter}`,
      key,
      ready: false,
      parsing: false,
      description: undefined
    };
    this.statements.set(key, prepared);
    this.trim(prepared);
    return prepared;
  }
  trim(protectedStatement) {
    while (this.statements.size > this.max) {
      let evicted;
      for (const prepared of this.statements.values()) {
        if (prepared !== protectedStatement && (prepared.ready || !prepared.parsing)) {
          evicted = prepared;
          break;
        }
      }
      if (evicted === undefined)
        return;
      this.statements.delete(evicted.key);
      if (evicted.ready)
        this.close(evicted.name);
    }
  }
  evict(prepared) {
    if (prepared.parsing)
      return;
    if (this.statements.delete(prepared.key) && prepared.ready)
      this.close(prepared.name);
  }
  evictFailed(prepared) {
    this.statements.delete(prepared.key);
    this.close(prepared.name);
  }
  close(name) {
    (this.closes ??= []).push(encodeClose({
      target: "statement",
      name
    }));
  }
  takeCloses() {
    const closes = this.closes;
    if (closes === undefined)
      return;
    this.closes = undefined;
    return {
      frames: closes.length === 1 ? closes[0] : concat(closes),
      count: closes.length
    };
  }
}
var isStalePreparedStatement = (code) => code === "26000" || code === "0A000";
var defaultBindEncoder = /* @__PURE__ */ makeBindEncoder(writeParameter, isTextFormat);
var makeBindEncoder2 = (registry) => registry === undefined ? defaultBindEncoder : makeBindEncoder((sink, parameter) => writeParameter(sink, parameter, registry), isTextFormat);
var queryError = (cause, message) => new SqlError({
  reason: new UnknownError2({
    cause,
    message,
    operation: "query"
  })
});
var retryStale = (plan, cache, run, rerun) => catchCause2(run, (cause) => {
  if (!plan.stale)
    return failCause3(cause);
  cache.evict(plan.prepared);
  return rerun();
});
var connectionQueryError = (cause, message) => new SqlError({
  reason: new ConnectionError({
    cause,
    message,
    operation: "query"
  })
});
var pinReleasedError = () => connectionQueryError(new Error("Pinned connection was released"), "PgConnection: Pinned connection was released");
var escapeIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
var skippedWhileDraining = (message) => message._tag === "DataRow" || message._tag === "CommandComplete" || message._tag === "EmptyQueryResponse" || message._tag === "ErrorResponse";
var parseCommandTag = (tag) => {
  const firstSpace = tag.indexOf(" ");
  if (firstSpace < 0)
    return {
      command: tag,
      oid: null,
      rowCount: 0
    };
  const command = tag.slice(0, firstSpace);
  const secondSpace = tag.indexOf(" ", firstSpace + 1);
  if (command === "INSERT" && secondSpace > 0) {
    return {
      command,
      oid: Number(tag.slice(firstSpace + 1, secondSpace)),
      rowCount: Number(tag.slice(secondSpace + 1))
    };
  }
  const last = tag.slice((secondSpace < 0 ? firstSpace : secondSpace) + 1);
  return {
    command,
    oid: null,
    rowCount: isDigits(last) ? Number(last) : 0
  };
};
var isDigits = (value) => {
  if (value.length === 0)
    return false;
  for (let index = 0;index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57)
      return false;
  }
  return true;
};

class QueryMachine {
  conn;
  plan;
  finish;
  readField;
  rows;
  values;
  closes;
  phase;
  fieldCount;
  resultFields;
  rowBuilder;
  command = "";
  rowCount = 0;
  oid = null;
  failure;
  done = false;
  aborted = false;
  drainDone;
  constructor(conn, plan, wantRows, finish) {
    this.conn = conn;
    this.plan = plan;
    this.finish = finish;
    this.rows = wantRows ? [] : undefined;
    this.values = wantRows ? undefined : [];
    this.closes = plan.closes;
    this.phase = plan.closes > 0 ? "close" : plan.parses ? "parse" : "bind";
    const description = plan.description;
    this.readField = description?.readField;
    this.fieldCount = description?.resultFields.length ?? 0;
    this.resultFields = description?.resultFields ?? emptyFields;
    this.rowBuilder = description?.rowBuilder;
  }
  isDone() {
    return this.done;
  }
  abort(onDrained) {
    if (this.done)
      return onDrained();
    this.aborted = true;
    this.drainDone = onDrained;
  }
  complete(effect) {
    if (this.done)
      return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== undefined)
      prepared.parsing = false;
    this.finish(effect);
  }
  failDesync(message) {
    this.conn.fatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  }
  onFatal(error) {
    if (this.done)
      return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== undefined)
      prepared.parsing = false;
    if (this.aborted)
      this.drainDone?.();
    else
      this.finish(fail6(this.failure ?? error));
  }
  onDecodeFailure(error) {
    if (this.done || this.aborted || this.phase === "drain")
      return;
    if (this.phase !== "rows")
      return this.failDesync(`Unexpected DataRow during ${this.phase}`);
    this.failure = error;
    this.phase = "drain";
    this.conn.session.parser.readField = undefined;
  }
  onMessage(message) {
    if (this.aborted) {
      if (message._tag === "ReadyForQuery") {
        this.done = true;
        this.drainDone?.();
      }
      return;
    }
    if (this.phase === "drain") {
      if (message._tag === "ReadyForQuery")
        return this.complete(fail6(this.failure));
      if (skippedWhileDraining(message))
        return;
      return this.failDesync(`Unexpected ${message._tag} after a row failed to decode`);
    }
    if (this.phase === "error") {
      if (message._tag === "ReadyForQuery") {
        if (this.plan.stale && !this.plan.parses && message.status === "E") {
          this.conn.prepared?.evict(this.plan.prepared);
          this.plan.stale = false;
        }
        return this.complete(fail6(this.failure));
      }
      return this.failDesync(`Unexpected ${message._tag} after ErrorResponse`);
    }
    switch (message._tag) {
      case "CloseComplete":
        if (this.phase !== "close")
          return this.failDesync(`Unexpected CloseComplete during ${this.phase}`);
        if (--this.closes === 0)
          this.phase = this.plan.parses ? "parse" : "bind";
        return;
      case "ParseComplete":
        if (this.phase !== "parse")
          return this.failDesync(`Unexpected ParseComplete during ${this.phase}`);
        this.phase = "bind";
        return;
      case "BindComplete":
        if (this.phase !== "bind")
          return this.failDesync(`Unexpected BindComplete during ${this.phase}`);
        this.phase = this.plan.describes ? "describe" : "rows";
        return;
      case "RowDescription": {
        if (this.phase !== "describe")
          return this.failDesync(`Unexpected RowDescription during ${this.phase}`);
        const description = describe(message.fields, this.conn.registry);
        if (isFailure2(description)) {
          return this.conn.fatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        this.fieldCount = message.fields.length;
        this.resultFields = description.success.resultFields;
        this.rowBuilder = description.success.rowBuilder;
        this.conn.session.parser.readField = description.success.readField;
        const prepared = this.plan.prepared;
        if (prepared !== undefined) {
          prepared.description = description.success;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "NoData": {
        if (this.phase !== "describe")
          return this.failDesync(`Unexpected NoData during ${this.phase}`);
        const prepared = this.plan.prepared;
        if (prepared !== undefined) {
          prepared.description = undefined;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "DataRow": {
        if (this.phase !== "rows" || this.rowBuilder === undefined) {
          return this.failDesync(`Unexpected DataRow during ${this.phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== this.fieldCount) {
          return this.failDesync(`DataRow has ${rowValues.length} values for ${this.fieldCount} fields`);
        }
        if (this.rows !== undefined)
          this.rows.push(this.rowBuilder(rowValues));
        else
          this.values.push(rowValues);
        return;
      }
      case "CommandComplete": {
        if (this.phase !== "rows")
          return this.failDesync(`Unexpected CommandComplete during ${this.phase}`);
        const parsed = parseCommandTag(message.commandTag);
        this.command = parsed.command;
        this.rowCount = parsed.rowCount;
        this.oid = parsed.oid;
        this.phase = "complete";
        return;
      }
      case "EmptyQueryResponse":
        if (this.phase !== "rows")
          return this.failDesync(`Unexpected EmptyQueryResponse during ${this.phase}`);
        this.phase = "complete";
        return;
      case "ErrorResponse": {
        if (isStalePreparedStatement(message.fields.code))
          this.plan.stale = true;
        const prepared = this.plan.prepared;
        if (this.plan.parses && prepared !== undefined && !prepared.ready) {
          this.conn.prepared?.evictFailed(prepared);
        }
        this.failure = new SqlError({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        this.phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (this.phase !== "complete")
          return this.failDesync(`Unexpected ReadyForQuery during ${this.phase}`);
        return this.complete(succeed6({
          result: {
            command: this.command,
            rowCount: this.rowCount,
            oid: this.oid,
            rows: this.rows ?? emptyRows,
            fields: this.resultFields
          },
          values: this.values ?? emptyValues
        }));
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return this.failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return this.failDesync(`Unexpected ${message._tag} during ${this.phase}`);
    }
  }
}
var emptyRows = [];
var emptyValues = [];
var drainAborted = (conn, timeoutMessage, abort) => {
  const drained = makeUnsafe2();
  const timeout = setTimeout(() => conn.fatal(connectionQueryError(new Error(timeoutMessage), `PgConnection: ${timeoutMessage}`)), abortDrainTimeoutMillis);
  abort(() => {
    clearTimeout(timeout);
    doneUnsafe(drained, void_4);
  });
  const grace = callback2((resume) => {
    const timer = setTimeout(() => resume(void_4), abortDrainGraceMillis);
    return sync2(() => clearTimeout(timer));
  });
  const cancelAndDrain = andThen2(conn.cancel, _await(drained));
  return andThen2(raceFirst2(_await(drained), grace), suspend2(() => isDoneUnsafe(drained) ? void_4 : cancelAndDrain));
};
var runQuery = (conn, plan, wantRows) => callback2((resume) => {
  if (conn.deadWith !== undefined) {
    resume(fail6(conn.deadWith));
    return;
  }
  const machine = new QueryMachine(conn, plan, wantRows, (effect) => {
    conn.consumer = undefined;
    resume(effect);
  });
  conn.consumer = machine;
  conn.session.parser.readField = machine.readField;
  try {
    conn.session.socket.write(plan.frame);
  } catch (cause) {
    conn.fatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return suspend2(() => {
    if (machine.isDone())
      return void_4;
    return drainAborted(conn, "Query cancellation timed out", (onDrained) => machine.abort(() => {
      conn.consumer = undefined;
      onDrained();
    }));
  });
});
var emptyFields = [];
var describe = (fields, registry) => {
  const reader = makeFieldReader(fields, registry);
  if (isFailure2(reader))
    return fail2(reader.failure);
  const resultFields = new Array(fields.length);
  for (let index = 0;index < fields.length; index++) {
    resultFields[index] = {
      name: fields[index].name,
      dataTypeId: fields[index].dataTypeOid
    };
  }
  return succeed2({
    readField: reader.success,
    rowBuilder: makeRowBuilder(fields),
    resultFields
  });
};
var makeRowBuilder = (fields) => {
  const names = new Array(fields.length);
  let hasProto = false;
  for (let index = 0;index < fields.length; index++) {
    const name = fields[index].name;
    names[index] = name;
    if (name === "__proto__")
      hasProto = true;
  }
  if (hasProto) {
    return (rowValues) => {
      const row = {};
      for (let index = 0;index < names.length; index++) {
        Object.defineProperty(row, names[index], {
          value: rowValues[index],
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return row;
    };
  }
  return (rowValues) => {
    const row = {};
    for (let index = 0;index < names.length; index++) {
      row[names[index]] = rowValues[index];
    }
    return row;
  };
};
var streamRows = (conn, pin, sql, params) => fromChannel2(fromTransform(fnUntraced2(function* (_, scope) {
  const pinned = yield* provide(pin, scope);
  yield* provide(acquireRelease2(conn.wire.take(1), () => conn.wire.release(1)), scope);
  if (pinned.released)
    return yield* pinReleasedError();
  const plan = yield* try_3({
    try: () => conn.encodeQuery(sql, params, undefined),
    catch: (cause) => queryError(cause, "PgConnection: Failed to encode query")
  });
  const frame = plan.frame;
  const socket = conn.session.socket;
  const parser = conn.session.parser;
  let phase = "parse";
  let fieldCount = 0;
  let rowBuilder;
  let buffer = [];
  let failure;
  let finished = false;
  let done = false;
  let aborted = false;
  let paused = false;
  let pending;
  let drainDone;
  const setPaused = (value) => {
    if (paused === value)
      return;
    paused = value;
    if (value)
      socket.pause();
    else
      socket.resume();
  };
  const deliver = () => {
    if (pending === undefined)
      return;
    const resume = pending;
    if (buffer.length > 0) {
      const chunk = buffer;
      buffer = [];
      pending = undefined;
      resume(succeed6(chunk));
    } else if (finished) {
      pending = undefined;
      resume(failure !== undefined ? fail6(failure) : done2());
    }
  };
  const onFatal = (error) => {
    if (done)
      return;
    done = true;
    finished = true;
    if (failure === undefined)
      failure = error;
    drainDone?.();
    deliver();
  };
  const failFatal = (error) => {
    conn.fatal(error);
    onFatal(error);
  };
  const failDesync = (message) => failFatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  const onMessage = (message) => {
    if (aborted) {
      if (message._tag === "ReadyForQuery") {
        done = true;
        conn.consumer = undefined;
        drainDone?.();
      }
      return;
    }
    if (phase === "error" || phase === "drain") {
      if (message._tag === "ReadyForQuery") {
        finished = true;
        done = true;
        conn.consumer = undefined;
        deliver();
        return;
      }
      if (phase === "error")
        return failDesync(`Unexpected ${message._tag} after ErrorResponse`);
      if (skippedWhileDraining(message))
        return;
      return failDesync(`Unexpected ${message._tag} after a row failed to decode`);
    }
    switch (message._tag) {
      case "ParseComplete":
        if (phase !== "parse")
          return failDesync(`Unexpected ParseComplete during ${phase}`);
        phase = "bind";
        return;
      case "BindComplete":
        if (phase !== "bind")
          return failDesync(`Unexpected BindComplete during ${phase}`);
        phase = "describe";
        return;
      case "RowDescription": {
        if (phase !== "describe")
          return failDesync(`Unexpected RowDescription during ${phase}`);
        const description = describe(message.fields, conn.registry);
        if (isFailure2(description)) {
          return failFatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        fieldCount = message.fields.length;
        rowBuilder = description.success.rowBuilder;
        parser.readField = description.success.readField;
        phase = "rows";
        return;
      }
      case "NoData":
        if (phase !== "describe")
          return failDesync(`Unexpected NoData during ${phase}`);
        phase = "rows";
        return;
      case "DataRow": {
        if (phase !== "rows" || rowBuilder === undefined) {
          return failDesync(`Unexpected DataRow during ${phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== fieldCount) {
          return failDesync(`DataRow has ${rowValues.length} values for ${fieldCount} fields`);
        }
        buffer.push(rowBuilder(rowValues));
        return;
      }
      case "CommandComplete":
        if (phase !== "rows")
          return failDesync(`Unexpected CommandComplete during ${phase}`);
        phase = "complete";
        return;
      case "EmptyQueryResponse":
        if (phase !== "rows")
          return failDesync(`Unexpected EmptyQueryResponse during ${phase}`);
        phase = "complete";
        return;
      case "ErrorResponse": {
        failure = new SqlError({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (phase !== "complete")
          return failDesync(`Unexpected ReadyForQuery during ${phase}`);
        finished = true;
        done = true;
        conn.consumer = undefined;
        deliver();
        return;
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return failDesync(`Unexpected ${message._tag} during ${phase}`);
    }
  };
  const onDecodeFailure = (error) => {
    if (done || aborted || phase === "drain")
      return;
    if (phase !== "rows")
      return failDesync(`Unexpected DataRow during ${phase}`);
    failure = error;
    phase = "drain";
    parser.readField = undefined;
  };
  const onBatchEnd = () => {
    if (done || aborted)
      return;
    if (pending !== undefined)
      deliver();
    else if (buffer.length >= streamPauseThreshold)
      setPaused(true);
  };
  yield* addFinalizer(scope, suspend2(() => {
    if (done || conn.deadWith !== undefined)
      return void_4;
    aborted = true;
    const drain = drainAborted(conn, "Stream cancellation timed out", (onDrained) => {
      drainDone = onDrained;
    });
    setPaused(false);
    return drain;
  }));
  if (conn.deadWith !== undefined)
    return yield* conn.deadWith;
  conn.consumer = {
    onMessage,
    onDecodeFailure,
    onBatchEnd,
    onFatal
  };
  parser.readField = undefined;
  try {
    socket.write(frame);
  } catch (cause) {
    failFatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return callback2((resume) => {
    pending = resume;
    setPaused(false);
    deliver();
    if (pending === undefined)
      return;
    return sync2(() => {
      if (pending === resume)
        pending = undefined;
    });
  });
})));
var listenChannel = (conn, pin, channel) => uninterruptibleMask2((restore) => gen2(function* () {
  const channelError = validateChannelName(channel, "listen");
  if (channelError !== undefined)
    return yield* fail6(channelError);
  const parentScope = yield* Scope;
  const scope = yield* fork(parentScope);
  return yield* restore(gen2(function* () {
    const pinned = yield* provide(pin, scope);
    if (conn.deadWith !== undefined)
      return yield* conn.deadWith;
    if (pinned.released)
      return yield* pinReleasedError();
    const queue = yield* unbounded();
    const identifier = escapeIdentifier(channel);
    let queues = conn.channels.get(channel);
    if (queues === undefined) {
      queues = new Set;
      conn.channels.set(channel, queues);
    }
    queues.add(queue);
    pinned.listeners++;
    yield* addFinalizer(scope, suspend2(() => {
      pinned.listeners--;
      const current = conn.channels.get(channel);
      if (current === undefined)
        return shutdown(queue);
      current.delete(queue);
      if (current.size > 0)
        return shutdown(queue);
      conn.channels.delete(channel);
      return andThen2(unlisten(conn, pinned, identifier), shutdown(queue));
    }));
    yield* pinned.query(`LISTEN ${identifier}`);
    return queue;
  })).pipe(tapCause2((cause) => close(scope, failCause2(cause))));
}));
var unlisten = (conn, pinned, identifier) => uninterruptible2(flatMap3(withoutYield(flatMap3(conn.wire.take(1), () => sync2(() => {
  pinned.unlistening++;
}))), () => {
  if (conn.deadWith !== undefined || pinned.released)
    return releaseUnlisten(conn, pinned);
  const timeout = setTimeout(() => conn.fatal(connectionQueryError(new Error("UNLISTEN timed out"), "PgConnection: UNLISTEN timed out")), unlistenTimeoutMillis);
  return ensuring2(ignore2(conn.cycleOwned(`UNLISTEN ${identifier}`, emptyParams, true, conn.prepared)), andThen2(sync2(() => clearTimeout(timeout)), releaseUnlisten(conn, pinned)));
}));
var releaseUnlisten = (conn, pinned) => withoutYield(suspend2(() => {
  pinned.unlistening--;
  return asVoid2(conn.wire.release(1));
}));
var withoutYield = (effect) => provideService2(effect, PreventSchedulerYield, true);
var sendCancelRequest = (config, session) => callback2((resume) => {
  let done = false;
  let socket;
  let timer;
  const finish = () => {
    if (done)
      return;
    done = true;
    if (timer !== undefined)
      clearTimeout(timer);
    socket?.destroy();
    resume(void_4);
  };
  const frame = encodeCancelRequest({
    pid: session.processId,
    secret: session.secretKey
  });
  const send = () => {
    socket.write(frame);
  };
  const begin = () => {
    if (config.ssl === false)
      return send();
    socket.once("data", (chunk) => {
      if (done)
        return;
      if (chunk.length === 1 && chunk[0] === 78 && config.sslOptional && !session.encrypted)
        return send();
      if (chunk.length !== 1 || chunk[0] !== 83)
        return finish();
      const raw = socket;
      raw.off("error", finish);
      raw.off("close", finish);
      socket = Tls.connect({
        host: config.host,
        servername: Net.isIP(config.host) === 0 ? config.host : undefined,
        ...typeof config.ssl === "object" ? config.ssl : {},
        socket: raw
      });
      socket.on("error", finish);
      socket.on("close", finish);
      socket.once("secureConnect", send);
    });
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== undefined ? config.stream() : config.path !== undefined ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true
    });
  } catch {
    resume(void_4);
    return;
  }
  timer = setTimeout(finish, cancelRequestTimeoutMillis);
  socket.on("error", finish);
  socket.on("close", finish);
  if (config.stream !== undefined)
    begin();
  else
    socket.once("connect", begin);
  return sync2(finish);
});
var connect3 = (config, resolvedPassword) => callback2((resume) => {
  let done = false;
  let socket;
  let encrypted = false;
  let parser;
  let sslErrorParser;
  let scram;
  let processId = 0;
  let secretKey = 0;
  const fail = (reason) => {
    if (done)
      return;
    done = true;
    socket?.destroy();
    resume(fail6(new SqlError({
      reason
    })));
  };
  const failConnect = (cause, message) => fail(new ConnectionError({
    cause,
    message,
    operation: "connect"
  }));
  const failAuth = (cause, message) => fail(new AuthenticationError({
    cause,
    message,
    operation: "connect"
  }));
  const onError = (cause) => failConnect(cause, "PgConnection: Failed to connect");
  const onClose = () => failConnect(new Error("Connection closed unexpectedly"), "PgConnection: Connection closed during startup");
  const password = () => {
    if (resolvedPassword === undefined) {
      failAuth(new Error("The server requested password authentication"), "PgConnection: No password configured");
      return;
    }
    return resolvedPassword;
  };
  const handleMessage = (message) => {
    switch (message._tag) {
      case "AuthenticationOk":
      case "NoticeResponse":
      case "NegotiateProtocolVersion":
      case "ParameterStatus":
        return;
      case "AuthenticationCleartextPassword": {
        const secret = password();
        if (secret === undefined)
          return;
        socket.write(encodePasswordMessage({
          password: secret
        }));
        return;
      }
      case "AuthenticationMD5Password": {
        const secret = password();
        if (secret === undefined)
          return;
        const hashed = md5Password({
          user: config.username,
          password: secret,
          salt: message.salt
        });
        if (isFailure2(hashed)) {
          return failAuth(hashed.failure, "PgConnection: MD5 authentication failed");
        }
        socket.write(encodePasswordMessage({
          password: hashed.success
        }));
        return;
      }
      case "AuthenticationSASL": {
        if (!message.mechanisms.includes(SCRAM_SHA_256)) {
          return failAuth(new Error(`Unsupported SASL mechanisms: ${message.mechanisms.join(", ")}`), `PgConnection: Only ${SCRAM_SHA_256} is supported`);
        }
        const secret = password();
        if (secret === undefined)
          return;
        const init = scramInit({
          password: secret,
          nonce: randomBytes(18).toString("base64")
        });
        if (isFailure2(init)) {
          return failAuth(init.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = init.success.state;
        socket.write(encodeSASLInitialResponse({
          mechanism: SCRAM_SHA_256,
          initialResponse: init.success.response
        }));
        return;
      }
      case "AuthenticationSASLContinue": {
        if (scram === undefined || scram._tag !== "ScramFirst") {
          return failConnect(new Error("Unexpected AuthenticationSASLContinue"), "PgConnection: Protocol desync");
        }
        const next = scramContinue(scram, message.data);
        if (isFailure2(next)) {
          return failAuth(next.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = next.success.state;
        socket.write(encodeSASLResponse({
          data: next.success.response
        }));
        return;
      }
      case "AuthenticationSASLFinal": {
        if (scram === undefined || scram._tag !== "ScramFinal") {
          return failConnect(new Error("Unexpected AuthenticationSASLFinal"), "PgConnection: Protocol desync");
        }
        const verified = scramFinish(scram, message.data);
        if (isFailure2(verified)) {
          return failAuth(verified.failure, "PgConnection: SCRAM server verification failed");
        }
        scram = undefined;
        return;
      }
      case "AuthenticationUnsupported":
        return failAuth(new Error(`Authentication method ${message.method} is not supported`), "PgConnection: Unsupported authentication method");
      case "BackendKeyData":
        processId = message.pid;
        secretKey = message.secret;
        return;
      case "ErrorResponse":
        return fail(classifyFields(message.fields, "PgConnection: Failed to connect", "connect"));
      case "ReadyForQuery":
        if (scram !== undefined) {
          return failAuth(new Error("The server completed authentication without proving its identity"), "PgConnection: SCRAM exchange did not complete");
        }
        done = true;
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.on("error", ignoreError);
        resume(succeed6({
          socket,
          encrypted,
          parser,
          processId,
          secretKey
        }));
        return;
      default:
        return failConnect(new Error(`Unexpected ${message._tag} message during startup`), "PgConnection: Protocol desync");
    }
  };
  const onData = (chunk) => {
    let messages;
    try {
      messages = parser.push(chunk);
    } catch (cause) {
      return failConnect(cause, "PgConnection: Failed to parse server response");
    }
    for (const message of messages) {
      if (done)
        return;
      handleMessage(message);
    }
  };
  const startup = () => {
    parser = makeParser({
      maxMessageSize: config.maxMessageSize
    });
    socket.on("data", onData);
    socket.write(encodeStartupMessage(config.startupParameters));
  };
  const onSslResponse = (chunk) => {
    if (done)
      return;
    if (sslErrorParser !== undefined || chunk[0] === 69) {
      sslErrorParser ??= makeParser({
        maxMessageSize: config.maxMessageSize
      });
      let messages;
      try {
        messages = sslErrorParser.push(chunk);
      } catch (cause) {
        return failConnect(cause, "PgConnection: Failed to parse SSLRequest error response");
      }
      if (messages.length === 0)
        return;
      socket.off("data", onSslResponse);
      const message = messages[0];
      if (messages.length !== 1 || message._tag !== "ErrorResponse") {
        return failConnect(new Error("Expected one ErrorResponse after SSLRequest"), "PgConnection: Invalid SSLRequest response");
      }
      return fail(classifyFields(message.fields, "PgConnection: Failed to negotiate TLS", "connect"));
    }
    socket.off("data", onSslResponse);
    if (chunk.length !== 1) {
      return failConnect(new Error(`Received ${chunk.length} bytes in response to SSLRequest`), "PgConnection: Invalid SSLRequest response");
    }
    const response = decodeSslResponse(chunk[0]);
    if (isFailure2(response)) {
      return failConnect(response.failure, "PgConnection: Invalid SSLRequest response");
    }
    if (response.success === "N") {
      if (config.sslOptional)
        return startup();
      return failConnect(new Error("The server does not support TLS"), "PgConnection: Server refused TLS");
    }
    const raw = socket;
    raw.off("error", onError);
    raw.off("close", onClose);
    socket = Tls.connect({
      host: config.host,
      servername: Net.isIP(config.host) === 0 ? config.host : undefined,
      ...typeof config.ssl === "object" ? config.ssl : {},
      socket: raw
    });
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.once("secureConnect", () => {
      encrypted = true;
      startup();
    });
  };
  const begin = () => {
    if (config.ssl === false)
      return startup();
    socket.on("data", onSslResponse);
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== undefined ? config.stream() : config.path !== undefined ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true,
      ...config.keepAlive !== undefined && {
        keepAlive: true,
        keepAliveInitialDelay: config.keepAlive
      }
    });
  } catch (cause) {
    resume(fail6(new SqlError({
      reason: new ConnectionError({
        cause,
        message: "PgConnection: Failed to connect",
        operation: "connect"
      })
    })));
    return;
  }
  socket.on("error", onError);
  socket.on("close", onClose);
  if (config.stream !== undefined) {
    begin();
  } else {
    socket.once("connect", begin);
  }
  return sync2(() => {
    if (done)
      return;
    done = true;
    socket.destroy();
  });
});
var ignoreError = (_) => {};
var classifyFields = (fields, message, operation) => {
  const cause = Object.assign(new Error(fields.message ?? "Unknown PostgreSQL error"), fields);
  return classifySqlState(fields.code, fields.constraint, {
    cause,
    message,
    operation
  });
};

// ../../node_modules/effect/dist/Pool.js
var TypeId29 = "~effect/Pool";
var Acquire = /* @__PURE__ */ Symbol();
var AcquireContext = /* @__PURE__ */ Symbol();
var PoolClock = /* @__PURE__ */ Symbol();
var makeWithTTL = (options) => flatMap3(options.timeToLiveStrategy === "creation" ? strategyCreationTTL(options.timeToLive) : strategyUsageTTL(options.timeToLive), (strategy) => makeWithStrategy({
  ...options,
  strategy
}));
var makeWithStrategy = (options) => uninterruptibleMask2(fnUntraced2(function* (restore) {
  const services = yield* context2();
  const scope = forkUnsafe2(get(services, Scope));
  const acquire = updateContext2(options.acquire, (input) => merge(services, input));
  const concurrency = options.concurrency ?? 1;
  const config = {
    acquire,
    concurrency,
    isFixed: options.min === options.max,
    minSize: options.min,
    maxSize: options.max,
    strategy: options.strategy,
    targetUtilization: Math.min(Math.max(options.targetUtilization ?? 1, 0.1), 1)
  };
  const state = {
    scope,
    isShuttingDown: false,
    usage: 0,
    resizeSemaphore: makeUnsafe5(1),
    items: new Set,
    availableHead: undefined,
    availableTail: undefined,
    invalidated: new Set,
    waiters: new Set
  };
  const self = {
    [TypeId29]: TypeId29,
    [Acquire]: options.acquire,
    [AcquireContext]: services,
    [PoolClock]: yield* Clock,
    config,
    state,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  yield* addFinalizer(scope, shutdown2(self));
  if (config.minSize > 0) {
    yield* tap2(forkDetach2(restore(resize(self)), {
      startImmediately: true
    }), (fiber) => addFinalizer(scope, interrupt4(fiber)));
  }
  if (options.strategy !== strategyNoop) {
    yield* tap2(forkDetach2(restore(options.strategy.run(self))), (fiber) => addFinalizer(scope, interrupt4(fiber)));
  }
  return self;
}));
var shutdown2 = /* @__PURE__ */ fnUntraced2(function* (self) {
  if (self.state.isShuttingDown)
    return;
  self.state.isShuttingDown = true;
  const size = self.state.items.size;
  const semaphore = makeUnsafe5(size);
  for (const item of self.state.items) {
    if (item.refCount > 0) {
      item.finalizer = tap2(item.finalizer, semaphore.release(1));
      self.state.invalidated.add(item);
      yield* semaphore.take(1);
    } else {
      self.state.items.delete(item);
      removeAvailable(self, item);
      self.state.invalidated.delete(item);
      yield* item.finalizer;
    }
  }
  if (self.state.waiters.size > 0) {
    const waiters = Array.from(self.state.waiters);
    self.state.waiters.clear();
    for (const notify of waiters)
      notify();
  }
  yield* semaphore.take(size);
});
var get2 = (self) => withFiber((fiber) => {
  const state = self.state;
  if (state.isShuttingDown)
    return interrupt;
  if (state.waiters.size === 0 && state.availableHead?.exit._tag === "Success") {
    state.usage++;
    if (self.config.isFixed || targetSize(self) <= activeSize(self)) {
      return leaseItem(self, state.availableHead, fiber);
    }
    state.usage--;
  }
  return getSlowWith(self, leaseItemWith);
});
var use = /* @__PURE__ */ dual(2, (self, f) => withFiber((fiber) => {
  const state = self.state;
  if (state.isShuttingDown)
    return interrupt;
  if (state.waiters.size === 0 && state.availableHead?.exit._tag === "Success") {
    state.usage++;
    if (self.config.isFixed || targetSize(self) <= activeSize(self)) {
      return useItem(self, state.availableHead, f, fiber);
    }
    state.usage--;
  }
  return getSlowWith(self, (self, item, fiber, restore) => useItem(self, item, f, fiber, restore));
}));
var useItem = (self, item, f, fiber, restore) => {
  leaseItemBookkeeping(self, item);
  onExitUnsafe(fiber, item.release);
  let body;
  try {
    body = f(item.exit.value);
  } catch (defect) {
    return exitDie(defect);
  }
  return restore !== undefined ? restore(body) : body;
};
var getSlowWith = (self, lease) => uninterruptibleMask((restore) => {
  const state = self.state;
  state.usage++;
  const waiter = makeWaiter();
  const wait = flatMap2(onError(restore(waitForItem(self, waiter)), () => withFiber((fiber) => {
    state.usage--;
    if (state.waiters.delete(waiter))
      wakeWaiters(self, fiber, 1);
    return void_2;
  })), () => loop);
  const step = withFiber((fiber) => {
    if (state.isShuttingDown) {
      state.usage--;
      return interrupt;
    }
    if (state.waiters.size > 0 && !state.waiters.has(waiter)) {
      return wait;
    }
    const item = firstHealthyAvailable(self) ?? (targetSize(self) <= activeSize(self) ? state.availableHead : undefined);
    if (item === undefined) {
      return wait;
    }
    if (item.exit._tag === "Failure") {
      removeFailedItem(self, item);
      return loop;
    }
    state.waiters.delete(waiter);
    return lease(self, item, fiber, restore);
  });
  const loop = suspend(() => {
    if (state.isShuttingDown) {
      state.usage--;
      return interrupt;
    }
    return targetSize(self) > activeSize(self) ? flatMap2(state.resizeSemaphore.withPermitsIfAvailable(1)(forkIn2(interruptible2(resize(self)), state.scope)), () => step) : step;
  });
  return loop;
});
var leaseItemBookkeeping = (self, item) => {
  item.refCount++;
  if (item.refCount >= self.config.concurrency) {
    removeAvailable(self, item);
  }
};
var removeFailedItem = (self, item) => {
  self.state.items.delete(item);
  self.state.invalidated.delete(item);
  removeAvailable(self, item);
};
var leaseItem = (self, item, fiber) => {
  leaseItemBookkeeping(self, item);
  const scope = getUnsafe(fiber.context, Scope);
  if (scope.state._tag === "Closed") {
    onExitUnsafe(fiber, item.release);
  } else {
    scopeAddFinalizerUnsafe(scope, {}, item.release);
  }
  return item.exit;
};
var leaseItemWith = (self, item, fiber) => leaseItem(self, item, fiber);
var releaseItem = (self, item) => withFiber((fiber) => {
  const state = self.state;
  item.refCount--;
  state.usage--;
  if (item.refCount === 0) {
    item.idleSince = self[PoolClock].currentTimeMillisUnsafe();
  }
  if (state.invalidated.has(item)) {
    return invalidatePoolItem(self, item);
  }
  if (item.refCount < self.config.concurrency) {
    addAvailableFront(self, item);
    wakeWaiters(self, fiber, 1);
  }
  return void_2;
});
var firstHealthyAvailable = (self) => {
  let item = self.state.availableHead;
  while (item !== undefined && item.exit._tag === "Failure")
    item = item.availableNext;
  return item;
};
var makeWaiter = () => {
  const waiter = (failure) => {
    const resume = waiter.resume;
    if (resume === undefined)
      return;
    waiter.resume = undefined;
    resume(failure ?? void_2);
  };
  waiter.resume = undefined;
  return waiter;
};
var waitForItem = (self, waiter) => callback((resume) => {
  const state = self.state;
  if (state.isShuttingDown || state.waiters.size === 0 && firstHealthyAvailable(self) !== undefined) {
    return resume(void_2);
  }
  waiter.resume = resume;
  state.waiters.add(waiter);
  return sync(() => {
    if (waiter.resume !== undefined) {
      waiter.resume = undefined;
      state.waiters.delete(waiter);
    }
  });
});
var wakeWaiters = (self, fiber, count) => {
  const waiters = self.state.waiters;
  if (waiters.size === 0)
    return;
  fiber.currentDispatcher.scheduleTask(() => {
    let remaining = count;
    for (const notify of waiters) {
      if (remaining <= 0 || self.state.availableHead === undefined)
        break;
      if (notify.resume === undefined)
        continue;
      remaining--;
      notify();
    }
  }, 0);
};
var firstSleepingWaiter = (self) => {
  for (const notify of self.state.waiters) {
    if (notify.resume !== undefined)
      return notify;
  }
  return;
};
var wakeAll = (self, fiber) => {
  const waiters = self.state.waiters;
  if (waiters.size === 0)
    return;
  fiber.currentDispatcher.scheduleTask(() => {
    for (const notify of Array.from(waiters))
      notify();
  }, 0);
};
var reservations = /* @__PURE__ */ new WeakMap;
var addAvailable = (self, item) => {
  if (item.isAvailable || reservations.has(item))
    return;
  item.isAvailable = true;
  item.availablePrevious = self.state.availableTail;
  item.availableNext = undefined;
  if (self.state.availableTail !== undefined) {
    self.state.availableTail.availableNext = item;
  } else {
    self.state.availableHead = item;
  }
  self.state.availableTail = item;
};
var addAvailableFront = (self, item) => {
  if (item.isAvailable || reservations.has(item))
    return;
  item.isAvailable = true;
  item.availablePrevious = undefined;
  item.availableNext = self.state.availableHead;
  if (self.state.availableHead !== undefined) {
    self.state.availableHead.availablePrevious = item;
  } else {
    self.state.availableTail = item;
  }
  self.state.availableHead = item;
};
var removeAvailable = (self, item) => {
  if (!item.isAvailable)
    return;
  item.isAvailable = false;
  if (item.availablePrevious !== undefined) {
    item.availablePrevious.availableNext = item.availableNext;
  } else {
    self.state.availableHead = item.availableNext;
  }
  if (item.availableNext !== undefined) {
    item.availableNext.availablePrevious = item.availablePrevious;
  } else {
    self.state.availableTail = item.availablePrevious;
  }
  item.availablePrevious = undefined;
  item.availableNext = undefined;
};
var invalidate = /* @__PURE__ */ dual(2, (self, item) => suspend2(() => {
  if (self.state.isShuttingDown)
    return void_4;
  for (const poolItem of self.state.items) {
    if (poolItem.exit._tag === "Success" && poolItem.exit.value === item) {
      poolItem.disableReclaim = true;
      return uninterruptible2(invalidatePoolItem(self, poolItem));
    }
  }
  return void_4;
}));
var reserve = /* @__PURE__ */ dual(2, (self, item) => asVoid2(acquireRelease2(sync2(() => {
  if (self.config.concurrency === 1)
    return;
  for (const poolItem of self.state.items) {
    if (poolItem.exit._tag !== "Success" || poolItem.exit.value !== item)
      continue;
    const existing = reservations.get(poolItem);
    if (existing === undefined)
      self.state.usage += self.config.concurrency - 1;
    reservations.set(poolItem, (existing ?? 0) + 1);
    removeAvailable(self, poolItem);
    return poolItem;
  }
  return;
}), (poolItem) => withFiber((fiber) => {
  if (poolItem === undefined)
    return void_2;
  const remaining = (reservations.get(poolItem) ?? 1) - 1;
  if (remaining > 0) {
    reservations.set(poolItem, remaining);
    return void_2;
  }
  reservations.delete(poolItem);
  self.state.usage -= self.config.concurrency - 1;
  if (!self.state.isShuttingDown && self.state.items.has(poolItem) && !self.state.invalidated.has(poolItem) && poolItem.refCount < self.config.concurrency) {
    addAvailableFront(self, poolItem);
    wakeWaiters(self, fiber, self.config.concurrency - poolItem.refCount);
  }
  return void_2;
}))));
var stats = (self) => sync2(() => {
  let idle = 0;
  let used = 0;
  for (const item of self.state.items) {
    if (item.exit._tag !== "Success")
      continue;
    if (item.refCount > 0 || reservations.has(item))
      used++;
    else
      idle++;
  }
  return {
    idle,
    used,
    pending: self.state.waiters.size,
    min: self.config.minSize,
    max: self.config.maxSize
  };
});
var invalidatePoolItem = (self, poolItem) => suspend2(() => {
  if (!self.state.items.has(poolItem)) {
    return void_4;
  } else if (poolItem.refCount === 0) {
    self.state.items.delete(poolItem);
    removeAvailable(self, poolItem);
    self.state.invalidated.delete(poolItem);
    return asVoid2(flatMap3(poolItem.finalizer, () => forkIn2(interruptible2(resize(self)), self.state.scope, {
      startImmediately: true
    })));
  }
  self.state.invalidated.add(poolItem);
  removeAvailable(self, poolItem);
  return asVoid2(forkIn2(interruptible2(resize(self)), self.state.scope, {
    startImmediately: true
  }));
});
var resize = (self) => self.state.resizeSemaphore.withPermits(1)(resizeLoop(self));
var resizeLoop = (self) => suspend2(() => {
  const active = activeSize(self);
  const target = targetSize(self);
  if (active >= target) {
    return void_4;
  }
  const toAcquire = target - active;
  const acquireOne = tap2(self.config.strategy === strategyNoop ? allocate(self) : flatMap3(self.config.strategy.reclaim(self), (item) => item ? sync2(() => {
    if (self.state.items.has(item) && !self.state.invalidated.has(item))
      addAvailableFront(self, item);
    return item;
  }) : allocate(self)), (item) => withFiber((fiber) => {
    if (item.exit._tag === "Failure")
      wakeAll(self, fiber);
    else
      wakeWaiters(self, fiber, self.config.concurrency);
    return void_2;
  }));
  if (toAcquire === 1) {
    return self.config.isFixed ? asVoid2(acquireOne) : flatMap3(acquireOne, (item) => item.exit._tag === "Failure" ? void_4 : resizeLoop(self));
  }
  const acquired = replicateEffect2(acquireOne, toAcquire, {
    concurrency: toAcquire
  });
  return self.config.isFixed ? asVoid2(acquired) : flatMap3(acquired, (items) => items.some((_) => _.exit._tag === "Failure") ? void_4 : resizeLoop(self));
});
var allocate = (self) => uninterruptibleMask((restore) => withFiber((fiber) => {
  const impl = self;
  const scope = scopeMakeUnsafe();
  const previousContext = fiber.context;
  fiber.setContext(add(impl[AcquireContext], Scope, scope));
  const use = flatMap3(exit2(impl[Acquire]), (exit) => {
    const item = {
      exit,
      finalizer: ignoreCause2(close(scope, exit), {
        log: "Unhandled",
        message: "Unhandled error in pool finalizer"
      }),
      refCount: 0,
      idleSince: impl[PoolClock].currentTimeMillisUnsafe(),
      disableReclaim: false,
      isAvailable: false,
      availablePrevious: undefined,
      availableNext: undefined,
      release: undefined
    };
    item.release = constant(releaseItem(self, item));
    const onAcquire = suspend2(() => self.state.items.has(item) ? self.config.strategy.onAcquire(item) : void_4);
    if (exit._tag === "Success") {
      self.state.items.add(item);
      addAvailable(self, item);
      return self.config.strategy === strategyNoop ? succeed6(item) : as2(onAcquire, item);
    }
    const waiter = firstHealthyAvailable(self) === undefined ? firstSleepingWaiter(self) : undefined;
    if (waiter !== undefined) {
      waiter(exit);
    } else {
      self.state.items.add(item);
      addAvailable(self, item);
    }
    return as2(forkIn2(andThen2(item.finalizer, onAcquire), self.state.scope, {
      startImmediately: true
    }), item);
  });
  return onExitPrimitive(restore(use), (exit) => {
    fiber.setContext(previousContext);
    return exit._tag === "Failure" ? scopeCloseUnsafe(scope, exit) : undefined;
  }, true);
}));
var targetSize = (self) => {
  if (self.state.isShuttingDown)
    return 0;
  if (self.config.isFixed)
    return self.config.minSize;
  const utilization = self.state.usage / self.config.targetUtilization;
  const target = Math.ceil(utilization / self.config.concurrency);
  return Math.min(Math.max(self.config.minSize, target), self.config.maxSize);
};
var activeSize = (self) => {
  return self.state.items.size - self.state.invalidated.size;
};
var strategyNoop = {
  run: (_) => void_4,
  onAcquire: (_) => void_4,
  reclaim: (_) => undefined_2
};
var strategyCreationTTL = /* @__PURE__ */ fnUntraced2(function* (ttl) {
  const clock = yield* Clock;
  const queue = yield* unbounded();
  const ttlMillis = toMillis(fromInputUnsafe(ttl));
  const creationTimes = new WeakMap;
  return identity({
    run: (pool) => {
      const process2 = (item) => suspend2(() => {
        if (!pool.state.items.has(item) || pool.state.invalidated.has(item)) {
          return void_4;
        }
        const now = clock.currentTimeMillisUnsafe();
        const created = creationTimes.get(item);
        const remaining = ttlMillis - (now - created);
        return remaining > 0 ? delay2(process2(item), remaining) : invalidatePoolItem(pool, item);
      });
      return take2(queue).pipe(tap2(process2), forever3({
        disableYield: true
      }));
    },
    onAcquire: (item) => suspend2(() => {
      creationTimes.set(item, clock.currentTimeMillisUnsafe());
      return offer(queue, item);
    }),
    reclaim: (_) => undefined_2
  });
});
var strategyUsageTTL = /* @__PURE__ */ fnUntraced2(function* (ttl) {
  const clock = yield* Clock;
  const ttlMillis = toMillis(fromInputUnsafe(ttl));
  return identity({
    run: (pool) => {
      const process2 = suspend2(() => {
        if (activeSize(pool) <= targetSize(pool))
          return void_4;
        const expired = clock.currentTimeMillisUnsafe() - ttlMillis;
        let oldest;
        for (const item of pool.state.items) {
          if (item.refCount > 0 || item.idleSince > expired)
            continue;
          if (pool.state.invalidated.has(item) || reservations.has(item))
            continue;
          if (oldest === undefined || item.idleSince < oldest.idleSince)
            oldest = item;
        }
        return oldest === undefined ? void_4 : flatMap3(invalidatePoolItem(pool, oldest), () => process2);
      });
      return process2.pipe(delay2(ttl), forever3({
        disableYield: true
      }));
    },
    onAcquire: (_) => void_4,
    reclaim: (_) => undefined_2
  });
});

// ../../node_modules/@effect/sql-pg/dist/PgPool.js
var defaultMultiplexConcurrency = 32;
var TypeId30 = "~@effect/sql-pg/PgPool";
var make22 = /* @__PURE__ */ fnUntraced2(function* (options) {
  const clock = yield* Clock;
  const runFork = runForkWith2(yield* context2());
  const multiplex = options.multiplex ?? false;
  const connectionTTL = options.connectionTTL !== undefined ? toMillis(fromInputUnsafe(options.connectionTTL)) : undefined;
  const acquireTimeout = options.acquireTimeout !== undefined ? fromInputUnsafe(options.acquireTimeout) : undefined;
  const deadConnections = new Set;
  const createdAt = new WeakMap;
  const checkedOut = new WeakSet;
  const connects = new WeakMap;
  const reportConnect = (connection) => withFiber2((fiber) => {
    const opened = connects.get(connection);
    if (opened === undefined)
      return void_4;
    connects.delete(connection);
    const statement = fiber.cache.span;
    if (!fiber.cache.tracerEnabled || statement?._tag !== "Span" || !fiber.getRef(SpanPropagationEnabled) || !fiber.getRef(TracerTimingEnabled2)) {
      return void_4;
    }
    const [startTime, endTime] = opened;
    const waitedFrom = statement.status.startTime;
    if (endTime < waitedFrom)
      return void_4;
    const span = fiber.getRef(Tracer).span({
      name: "db.connect",
      parent: some2(statement),
      annotations: empty(),
      links: [],
      startTime: startTime > waitedFrom ? startTime : waitedFrom,
      kind: "client",
      root: false,
      sampled: statement.sampled
    });
    span.attribute("db.system.name", "postgresql");
    span.attribute("db.client.connection.connect_time_ms", Number(endTime - startTime) / 1e6);
    span.end(endTime, void_3);
    return void_4;
  });
  const handOut = (connection) => connects.has(connection) ? as2(reportConnect(connection), connection) : succeed6(connection);
  let pool;
  const acquire = suspend2(() => {
    const startTime = clock.currentTimeNanosUnsafe();
    return tap2(make21(options), (connection) => sync2(() => {
      connects.set(connection, [startTime, clock.currentTimeNanosUnsafe()]);
      createdAt.set(connection, clock.currentTimeMillisUnsafe());
      const internals = connectionInternals(connection);
      internals.retireHooks.add(() => {
        deadConnections.add(connection);
        runFork(invalidate(pool, connection));
      });
      if (multiplex)
        internals.reserve = reserve(pool, connection);
    }));
  });
  const maxConnections = options.maxConnections ?? 10;
  pool = yield* makeWithTTL({
    acquire,
    min: options.minConnections ?? 0,
    max: maxConnections,
    concurrency: multiplex ? Math.max(1, options.multiplexConcurrency ?? defaultMultiplexConcurrency) : 1,
    timeToLive: options.idleTimeout ?? seconds(60),
    timeToLiveStrategy: "usage"
  });
  const expired = (connection) => {
    if (connectionInternals(connection).deadError() !== undefined)
      return true;
    if (connectionTTL === undefined)
      return false;
    if (!checkedOut.has(connection)) {
      checkedOut.add(connection);
      return false;
    }
    const openedAt = createdAt.get(connection);
    return openedAt !== undefined && clock.currentTimeMillisUnsafe() - openedAt >= connectionTTL;
  };
  const retry = gen2(function* () {
    while (true) {
      if (deadConnections.size > 0) {
        const dead = Array.from(deadConnections);
        deadConnections.clear();
        yield* forEach2(dead, (connection) => invalidate(pool, connection), {
          discard: true
        });
      }
      const connection = yield* get2(pool);
      if (expired(connection)) {
        yield* invalidate(pool, connection);
        continue;
      }
      return connection;
    }
  });
  const checkout = suspend2(() => deadConnections.size > 0 ? retry : flatMap3(get2(pool), (connection) => expired(connection) ? andThen2(invalidate(pool, connection), retry) : succeed6(connection)));
  const acquireTimedOut = () => fail6(new SqlError({
    reason: new ConnectionError({
      cause: new Error("Timed out waiting for a pooled connection"),
      message: "PgPool: Timed out waiting for a pooled connection",
      operation: "acquireConnection"
    })
  }));
  const withAcquireTimeout = (effect) => acquireTimeout === undefined ? effect : uninterruptibleMask2((restore) => flatMap3(scope2, (parent) => flatMap3(fork(parent), (scope) => onError2(restore(timeoutOrElse2(provide(effect, scope), {
    duration: acquireTimeout,
    orElse: acquireTimedOut
  })), (cause) => close(scope, failCause2(cause))))));
  const handedOut = flatMap3(checkout, handOut);
  const get = withAcquireTimeout(handedOut);
  const reserve2 = withAcquireTimeout(flatMap3(handedOut, (connection) => connection.pin));
  const use2 = (f) => suspend2(() => connectionTTL === undefined && acquireTimeout === undefined && deadConnections.size === 0 ? use(pool, (connection) => connects.has(connection) ? andThen2(reportConnect(connection), f(connection)) : f(connection)) : scoped2(flatMap3(get, f)));
  const pgPool = {
    [TypeId30]: TypeId30,
    config: options,
    get,
    reserve: reserve2,
    use: use2,
    invalidate: (connection) => invalidate(pool, connectionInternals(connection).base),
    stats: stats(pool)
  };
  return pgPool;
});

// ../../node_modules/@effect/sql-pg/dist/PgClient.js
var TypeId31 = "~@effect/sql-pg/PgClient";
var PgClient = /* @__PURE__ */ Service("@effect/sql-pg/PgClient");
var make23 = (options) => flatMap3(make22(options), (pool) => makeImpl2({
  acquirer: map6(pool.get, makeConnection),
  borrower: (f) => pool.use((connection) => f(makeConnection(connection))),
  transactionAcquirer: map6(pool.reserve, makeConnection),
  listenAcquirer: pool.reserve,
  config: options,
  poolStats: pool.stats
}));
var makeImpl2 = /* @__PURE__ */ fnUntraced2(function* (options) {
  const hook = options.config.onAcquire;
  const context = yield* context2();
  const onAcquire = hook && updateContext2(hook, (current) => merge(context, current));
  const config = {
    ...options.config,
    onAcquire
  };
  const resolved = yield* resolveConfig(config);
  let {
    acquirer,
    borrower,
    listenAcquirer,
    transactionAcquirer
  } = options;
  if (onAcquire !== undefined) {
    acquirer = tap2(acquirer, onAcquire);
    transactionAcquirer = tap2(transactionAcquirer, onAcquire);
    listenAcquirer = tap2(listenAcquirer, onAcquire);
    if (borrower !== undefined) {
      const borrow = borrower;
      borrower = (f) => borrow((connection) => scoped2(andThen2(onAcquire, f(connection))));
    }
  }
  const compiler = makeCompiler2(config.transformQueryNames, config.transformJson);
  const transformRows = config.transformResultNames ? defaultTransforms(config.transformResultNames, config.transformJson).array : undefined;
  const listen = (channel) => flatMap3(listenAcquirer, (connection) => connection.listen(channel));
  return Object.assign(yield* make20({
    driver: "pg",
    acquirer,
    borrower,
    prepareTransactionControls: true,
    commit,
    onCommitFailure,
    isTransaction: (conn) => connectionInternals(conn.connection).deadError() === undefined,
    releaseSavepoint: (name) => `RELEASE SAVEPOINT ${name}`,
    transactionAcquirer,
    compiler,
    spanAttributes: [
      ...config.spanAttributes ? Object.entries(config.spanAttributes) : [],
      [ATTR_DB_SYSTEM_NAME, "postgresql"],
      [ATTR_DB_NAMESPACE, resolved.startupParameters.database ?? resolved.username],
      [ATTR_SERVER_ADDRESS, resolved.host],
      [ATTR_SERVER_PORT, resolved.port]
    ],
    transformRows
  }), {
    [TypeId31]: TypeId31,
    config,
    poolStats: options.poolStats,
    json: (_) => fragment([PgJson(_)]),
    listen,
    notify: (channel, payload) => {
      const channelError = validateChannelName(channel, "notify");
      return channelError !== undefined ? fail6(channelError) : asVoid2(scoped2(flatMap3(acquirer, (conn) => conn.executeRaw(`SELECT pg_notify($1, $2)`, [channel, payload]))));
    }
  });
});

class ConnectionImpl {
  connection;
  streamAcquirer;
  constructor(connection, streamAcquirer) {
    this.connection = connection;
    this.streamAcquirer = streamAcquirer;
  }
  run(query, params, prepare = true) {
    return map6(this.connection.query(query, params, prepare), (result) => result.rows);
  }
  execute(sql, params, transformRows) {
    return transformRows ? map6(this.run(sql, params), transformRows) : this.run(sql, params);
  }
  executeRaw(sql, params) {
    return this.connection.query(sql, params);
  }
  executeWithoutTransform(sql, params) {
    return this.run(sql, params);
  }
  executeValues(sql, params) {
    return this.connection.queryValues(sql, params);
  }
  executeValuesUnprepared(sql, params) {
    return this.connection.queryValues(sql, params, false);
  }
  executeUnprepared(sql, params, transformRows) {
    const operation = this.run(sql, params, false);
    return transformRows ? map6(operation, transformRows) : operation;
  }
  executeStream(sql, params, transformRows) {
    const stream = this.streamAcquirer === undefined ? this.connection.stream(sql, params) : unwrap2(map6(this.streamAcquirer, (connection) => connection.stream(sql, params)));
    return transformRows ? mapArray(stream, (rows) => transformRows(rows)) : stream;
  }
}
var commit = (conn) => flatMap3(conn.executeRaw("COMMIT", []), (result) => result.command === "ROLLBACK" ? fail6(new SqlError({
  reason: new UnknownError2({
    cause: new Error("COMMIT rolled back an aborted transaction"),
    message: "PgClient: COMMIT rolled back an aborted transaction",
    operation: "commit"
  })
})) : void_4);
var onCommitFailure = (conn) => ignore2(conn.executeUnprepared("ROLLBACK", [], undefined));
var makeConnection = (connection, streamAcquirer) => new ConnectionImpl(connection, streamAcquirer);
var layerFrom = (acquire) => effectContext(map6(acquire, (client) => make3(PgClient, client).pipe(add(SqlClient, client)))).pipe(provide2(layer));
var layer2 = (config) => layerFrom(make23(config));
var makeCompiler2 = (transform, transformJson = true) => {
  const transformValue = transformJson && transform ? defaultTransforms(transform).value : undefined;
  return makeCompiler({
    dialect: "pg",
    placeholder(_) {
      return `$${_}`;
    },
    onIdentifier: transform ? function(value, withoutTransform) {
      return withoutTransform ? escape(value) : escape(transform(value));
    } : escape,
    onRecordUpdate(placeholders, valueAlias, valueColumns, values, returning) {
      return [`(values ${placeholders}) AS ${valueAlias}${valueColumns}${returning ? ` RETURNING ${returning[0]}` : ""}`, returning ? values.flat().concat(returning[1]) : values.flat()];
    },
    onCustom(type, placeholder, withoutTransform) {
      switch (type.kind) {
        case "PgJson": {
          const value = withoutTransform || transformValue === undefined ? type.paramA : transformValue(type.paramA);
          return [placeholder(undefined), [jsonb(value)]];
        }
      }
    }
  });
};
var escape = /* @__PURE__ */ defaultEscape('"');
var PgJson = /* @__PURE__ */ custom("PgJson");
var ATTR_DB_SYSTEM_NAME = "db.system.name";
var ATTR_DB_NAMESPACE = "db.namespace";
var ATTR_SERVER_ADDRESS = "server.address";
var ATTR_SERVER_PORT = "server.port";
// ../../node_modules/effect/dist/http/HttpBody.js
var TypeId32 = "~effect/http/HttpBody";
class Proto6 {
  [TypeId32];
  constructor() {
    this[TypeId32] = TypeId32;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  toString() {
    return format(this, {
      ignoreToString: true
    });
  }
}

class Empty2 extends Proto6 {
  _tag = "Empty";
  toJSON() {
    return {
      _id: "effect/HttpBody",
      _tag: "Empty"
    };
  }
}
var empty7 = /* @__PURE__ */ new Empty2;
var buffer2 = globalThis.Buffer;

// ../../node_modules/effect/dist/http/HttpClientError.js
var TypeId33 = "~effect/http/HttpClientError";
var isHttpClientError = (u) => hasProperty(u, TypeId33);

class HttpClientError extends (/* @__PURE__ */ TaggedError2("HttpClientError")) {
  constructor(props) {
    if ("cause" in props.reason) {
      super({
        ...props,
        cause: props.reason.cause
      });
    } else {
      super(props);
    }
  }
  [TypeId33] = TypeId33;
  get request() {
    return this.reason.request;
  }
  get response() {
    return "response" in this.reason ? this.reason.response : undefined;
  }
  get message() {
    return this.reason.message;
  }
}
var formatReason = (tag) => tag.endsWith("Error") ? tag.slice(0, -5) : tag;
var formatMessage = (reason, description, info) => description ? `${reason}: ${description} (${info})` : `${reason} error (${info})`;
var responseRedactedNames = /* @__PURE__ */ new WeakMap;
var redactedUrls = /* @__PURE__ */ new WeakMap;
var addRedactedNames = (reason, names) => {
  const url = redactedUrls.get(reason);
  if (url !== undefined && names !== undefined)
    redactedUrls.set(reason, redactUrl(url, names));
};
var addResponseRedactedNames = (response, names) => {
  const existing = responseRedactedNames.get(response);
  responseRedactedNames.set(response, existing === undefined ? names : [...existing, ...names]);
};
var addFailureRedactedNames = (cause, names) => {
  for (const reason of cause.reasons) {
    if (isFailReason2(reason) && isHttpClientError(reason.error))
      addRedactedNames(reason.error.reason, names);
  }
};
var ReasonError = (tag) => {

  class Base extends TaggedError2(tag) {
    constructor(props) {
      super(props);
      redactedUrls.set(this, redactUrl(props.request.url));
      if (props.response !== undefined)
        addRedactedNames(this, responseRedactedNames.get(props.response));
    }
  }
  return Base;
};
var redactedUrl = (reason) => redactUrl(redactedUrls.get(reason) ?? reason.request.url);
var formatMethodAndUrl = (reason) => `${reason.request.method} ${redactedUrl(reason)}`;
var reasonToJSON = (reason, json) => ({
  ...json,
  request: {
    _id: "HttpClientRequest",
    method: reason.request.method,
    url: redactedUrl(reason)
  },
  ..."response" in reason ? {
    response: {
      _id: "HttpClientResponse",
      status: reason.response.status
    }
  } : undefined
});

class TransportError extends (/* @__PURE__ */ ReasonError("TransportError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    return formatMessage(formatReason(this._tag), this.description, this.methodAndUrl);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

class EncodeError2 extends (/* @__PURE__ */ ReasonError("EncodeError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    return formatMessage(formatReason(this._tag), this.description, this.methodAndUrl);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

class InvalidUrlError extends (/* @__PURE__ */ ReasonError("InvalidUrlError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    return formatMessage(formatReason(this._tag), this.description, this.methodAndUrl);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

class StatusCodeError extends (/* @__PURE__ */ ReasonError("StatusCodeError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    const info = `${this.response.status} ${this.methodAndUrl}`;
    return formatMessage(formatReason(this._tag), this.description, info);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

class DecodeError extends (/* @__PURE__ */ ReasonError("DecodeError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    const info = `${this.response.status} ${this.methodAndUrl}`;
    return formatMessage(formatReason(this._tag), this.description, info);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

class EmptyBodyError extends (/* @__PURE__ */ ReasonError("EmptyBodyError")) {
  get methodAndUrl() {
    return formatMethodAndUrl(this);
  }
  get message() {
    const info = `${this.response.status} ${this.methodAndUrl}`;
    return formatMessage(formatReason(this._tag), this.description, info);
  }
  toJSON() {
    return reasonToJSON(this, super.toJSON());
  }
}

// ../../node_modules/effect/dist/http/HttpMethod.js
var allShort = [["GET", "get"], ["POST", "post"], ["PUT", "put"], ["DELETE", "del"], ["PATCH", "patch"], ["HEAD", "head"], ["OPTIONS", "options"], ["TRACE", "trace"], ["QUERY", "query"]];

// ../../node_modules/effect/dist/http/internal/httpBody.js
var updateHeaders = (headers, body) => {
  if (body._tag === "Empty" || body._tag === "FormData") {
    return remove2(remove2(headers, "content-type"), "content-length");
  }
  headers = body.contentType === undefined ? remove2(headers, "content-type") : set2(headers, "content-type", body.contentType);
  return updateContentLength(headers, body);
};
var updateContentLength = (headers, body) => {
  const contentLength = body._tag === "Empty" || body._tag === "FormData" ? undefined : body.contentLength;
  return contentLength === undefined ? remove2(headers, "content-length") : set2(headers, "content-length", contentLength.toString());
};

// ../../node_modules/effect/dist/http/Url.js
class UrlError extends (/* @__PURE__ */ TaggedError2("UrlError")) {
}
var make24 = (url, params, hash) => try_({
  try: () => {
    const urlInstance = new URL(url, baseUrl());
    for (let i = 0;i < params.params.length; i++) {
      const [key, value] = params.params[i];
      if (value !== undefined) {
        urlInstance.searchParams.append(key, unwrap3(value));
      }
    }
    if (hash !== undefined) {
      urlInstance.hash = hash;
    }
    return urlInstance;
  },
  catch: (cause) => new UrlError({
    cause
  })
});
var baseUrl = () => {
  if ("location" in globalThis && globalThis.location !== undefined && globalThis.location.origin !== undefined && globalThis.location.pathname !== undefined) {
    const base = location.origin + location.pathname;
    try {
      return new URL(base).href;
    } catch {
      return;
    }
  }
  return;
};

// ../../node_modules/effect/dist/http/HttpClientRequest.js
var TypeId34 = "~effect/http/HttpClientRequest";
var Proto7 = {
  [TypeId34]: TypeId34,
  ...BaseProto,
  toJSON() {
    return {
      _id: "HttpClientRequest",
      method: this.method,
      url: redactUrl(this.url),
      urlParams: this.urlParams,
      hash: this.hash,
      headers: redact(this.headers),
      body: this.body.toJSON()
    };
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
function makeWith(method, url, urlParams, hash, headers, body) {
  const self = Object.create(Proto7);
  self.method = method;
  self.url = url;
  self.urlParams = urlParams;
  self.hash = hash;
  self.headers = headers;
  self.body = body;
  return self;
}
var empty8 = /* @__PURE__ */ makeWith("GET", "", empty5, /* @__PURE__ */ none2(), empty4, empty7);
var make25 = (method) => (url, options) => modify(empty8, {
  method,
  url,
  ...options ?? undefined
});
var modify = /* @__PURE__ */ dual(2, (self, options) => {
  let result = self;
  if (options.method) {
    result = setMethod(result, options.method);
  }
  if (options.url) {
    result = setUrl(result, options.url);
  }
  if (options.headers) {
    result = setHeaders(result, options.headers);
  }
  if (options.urlParams) {
    result = setUrlParams(result, options.urlParams);
  }
  if (options.hash) {
    result = setHash(result, options.hash);
  }
  if (options.body) {
    result = setBody(result, options.body);
  }
  if (options.accept) {
    result = accept(result, options.accept);
  }
  if (options.acceptJson) {
    result = acceptJson(result);
  }
  return result;
});
var setMethod = /* @__PURE__ */ dual(2, (self, method) => makeWith(method, self.url, self.urlParams, self.hash, self.headers, self.body));
var setHeader = /* @__PURE__ */ dual(3, (self, key, value) => makeWith(self.method, self.url, self.urlParams, self.hash, set2(self.headers, key, value), self.body));
var setHeaders = /* @__PURE__ */ dual(2, (self, input) => makeWith(self.method, self.url, self.urlParams, self.hash, setAll(self.headers, input), self.body));
var accept = /* @__PURE__ */ dual(2, (self, mediaType) => setHeader(self, "Accept", mediaType));
var acceptJson = /* @__PURE__ */ accept("application/json");
var setUrl = /* @__PURE__ */ dual(2, (self, url) => {
  if (typeof url === "string") {
    return makeWith(self.method, url, self.urlParams, self.hash, self.headers, self.body);
  }
  const clone = new URL(url.toString());
  const urlParams = fromInput3(clone.searchParams);
  const hash = fromNullishOr(clone.hash === "" ? undefined : clone.hash.slice(1));
  clone.search = "";
  clone.hash = "";
  return makeWith(self.method, clone.toString(), urlParams, hash, self.headers, self.body);
});
var setUrlParams = /* @__PURE__ */ dual(2, (self, input) => makeWith(self.method, self.url, setAll2(self.urlParams, input), self.hash, self.headers, self.body));
var setHash = /* @__PURE__ */ dual(2, (self, hash) => makeWith(self.method, self.url, self.urlParams, some2(hash), self.headers, self.body));
var setBody = /* @__PURE__ */ dual(2, (self, body) => {
  return makeWith(self.method, self.url, self.urlParams, self.hash, updateHeaders(self.headers, body), body);
});
function toUrl(self) {
  const r = make24(self.url, self.urlParams, getOrUndefined(self.hash));
  if (isSuccess2(r)) {
    return some2(r.success);
  }
  return none2();
}

// ../../node_modules/effect/dist/http/HttpIncomingMessage.js
var TypeId35 = "~effect/http/HttpIncomingMessage";
var schemaBodyJson = (schema, options) => {
  const decode = decodeEffect2(toCodecJson2(schema));
  const decodeJson = options?.reviver === undefined ? undefined : decodeEffect2(fromJsonString2(toCodecJson2(schema), options));
  return (self) => decodeJson === undefined ? flatMap3(self.json, (u) => decode(u, options)) : flatMap3(self.text, (body) => body === "" ? flatMap3(self.json, (u) => decode(u, options)) : decodeJson(body, options));
};
var inspect = (self, that) => {
  return {
    ...that,
    headers: redact(self.headers),
    remoteAddress: self.remoteAddress
  };
};

// ../../node_modules/effect/dist/http/internal/webResponse.js
var WebSourceSymbol = "~effect/http/HttpClientResponse/WebSource";
var getWebSource = (self) => self[WebSourceSymbol]?.();

// ../../node_modules/effect/dist/http/HttpClientResponse.js
var TypeId36 = "~effect/http/HttpClientResponse";
var fromWeb = (request, source) => new WebHttpClientResponse(request, source);
var filterStatusOk = (self) => self.status >= 200 && self.status < 300 ? succeed6(self) : fail6(new HttpClientError({
  reason: new StatusCodeError({
    response: self,
    request: self.request,
    description: "non 2xx status code"
  })
}));

class WebHttpClientResponse extends Class2 {
  [TypeId35];
  [TypeId36];
  request;
  source;
  constructor(request, source) {
    super();
    this.request = request;
    this.source = source;
    this[TypeId35] = TypeId35;
    this[TypeId36] = TypeId36;
  }
  toJSON() {
    return inspect(this, {
      _id: "HttpClientResponse",
      request: this.request.toJSON(),
      status: this.status
    });
  }
  get status() {
    return this.source.status;
  }
  get url() {
    if (this.source.url)
      return this.source.url.split("#")[0];
    const url = toUrl(this.request);
    if (isNone2(url))
      return "";
    url.value.hash = "";
    return url.value.href;
  }
  get headers() {
    return fromInput2(this.source.headers);
  }
  cachedCookies;
  get cookies() {
    if (this.cachedCookies) {
      return this.cachedCookies;
    }
    return this.cachedCookies = fromSetCookie(this.source.headers.getSetCookie?.() ?? []);
  }
  get remoteAddress() {
    return none2();
  }
  [WebSourceSymbol]() {
    return this.source;
  }
  get stream() {
    return this.source.body ? fromReadableStream2({
      evaluate: () => this.source.body,
      onError: (cause) => new HttpClientError({
        reason: new DecodeError({
          request: this.request,
          response: this,
          cause
        })
      })
    }) : fail8(new HttpClientError({
      reason: new EmptyBodyError({
        request: this.request,
        response: this,
        description: "can not create stream from empty body"
      })
    }));
  }
  get json() {
    return flatMap3(this.text, (text) => try_3({
      try: () => text === "" ? null : JSON.parse(text),
      catch: (cause) => new HttpClientError({
        reason: new DecodeError({
          request: this.request,
          response: this,
          cause
        })
      })
    }));
  }
  textBody;
  get text() {
    return this.textBody ??= map6(this.arrayBuffer, (_) => new TextDecoder().decode(_));
  }
  get urlParamsBody() {
    return flatMap3(this.arrayBuffer, (bytes) => try_3({
      try: () => fromInput3(fromBody(bytes)),
      catch: (cause) => new HttpClientError({
        reason: new DecodeError({
          request: this.request,
          response: this,
          cause
        })
      })
    }));
  }
  formDataBody;
  get formData() {
    return this.formDataBody ??= tryPromise2({
      try: () => this.source.formData(),
      catch: (cause) => new HttpClientError({
        reason: new DecodeError({
          request: this.request,
          response: this,
          cause
        })
      })
    }).pipe(cached2, runSync2);
  }
  arrayBufferBody;
  get arrayBuffer() {
    if (this.arrayBufferBody) {
      return this.arrayBufferBody;
    }
    this.arrayBufferBody = tryPromise2({
      try: () => this.source.arrayBuffer(),
      catch: (cause) => new HttpClientError({
        reason: new DecodeError({
          request: this.request,
          response: this,
          cause
        })
      })
    }).pipe(cached2, runSync2);
    return this.arrayBufferBody;
  }
  get upgrade() {
    return fail6(new HttpClientError({
      reason: new StatusCodeError({
        request: this.request,
        response: this,
        description: "fetch cannot hand over the connection of an HTTP upgrade"
      })
    }));
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
}

// ../../node_modules/effect/dist/http/HttpTraceContext.js
var toHeaders = (span) => fromRecordUnsafe({
  b3: `${span.traceId}-${span.spanId}-${span.sampled ? "1" : "0"}${match(span.parent, {
    onNone: () => "",
    onSome: (parent) => `-${parent.spanId}`
  })}`,
  traceparent: `00-${span.traceId.padStart(32, "0")}-${span.spanId}-${span.sampled ? "01" : "00"}`
});

// ../../node_modules/effect/dist/http/internal/tracing.js
var defaultPorts = {
  "http:": 80,
  "https:": 443,
  "ws:": 80,
  "wss:": 443
};
var addUrlAttributes = (span, url, redactedNames) => {
  const query = redactUrl(url.search, redactedNames).slice(1);
  span.attribute("url.full", redactUrl(url.href, redactedNames));
  span.attribute("url.path", url.pathname);
  if (query !== "") {
    span.attribute("url.query", query);
  }
  span.attribute("url.scheme", url.protocol.slice(0, -1));
  if (url.hostname !== "") {
    span.attribute("server.address", url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname);
    const port = url.port === "" ? defaultPorts[url.protocol] : Number(url.port);
    if (port !== undefined) {
      span.attribute("server.port", port);
    }
  }
};
var redactedNames = (urlParams, redactedNames) => {
  const keys = urlParams.params.filter(([, value]) => typeof value !== "string").map(([key]) => key);
  return keys.length === 0 ? redactedNames : [...redactedNames, ...new URLSearchParams(keys.map((key) => [key, ""])).keys()];
};
var addHeaderAttributes = (span, phase, headers, filter, redactedNames) => {
  for (const name in headers) {
    if (!filter(name, phase))
      continue;
    span.attribute(`http.${phase}.header.${name}`, isRedactedName(name, redactedNames) ? "<redacted>" : headers[name]);
  }
};

// ../../node_modules/effect/dist/http/HttpClient.js
var TypeId37 = "~effect/http/HttpClient";
var HttpClient = /* @__PURE__ */ Service("effect/HttpClient");
var transformResponse = /* @__PURE__ */ dual(2, (self, f) => makeWith2((request) => f(self.postprocess(request)), self.preprocess));
var makeWith2 = (postprocess, preprocess) => {
  const self = Object.create(Proto8);
  self.preprocess = preprocess;
  self.postprocess = postprocess;
  self.execute = function(request) {
    return postprocess(preprocess(request));
  };
  return self;
};
var Proto8 = {
  [TypeId37]: TypeId37,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...BaseProto,
  toJSON() {
    return {
      _id: "effect/HttpClient"
    };
  },
  .../* @__PURE__ */ Object.fromEntries(/* @__PURE__ */ allShort.map(([fullMethod, method]) => [method, function(url, options) {
    return this.execute(make25(fullMethod)(url, options));
  }]))
};
var make26 = (f) => makeWith2((effect) => flatMap3(effect, (request) => withFiber2((fiber) => {
  const scope = fiber.getRef(RequestScope);
  const controller = new AbortController;
  const urlParamsRedactedNames = fiber.getRef(CurrentRedactedNames2);
  const urlResult = make24(request.url, request.urlParams, getOrUndefined(request.hash));
  if (isFailure2(urlResult)) {
    return fail6(new HttpClientError({
      reason: new InvalidUrlError({
        request,
        cause: urlResult.failure
      })
    }));
  }
  const url = urlResult.success;
  const send = (request) => scope === undefined ? f(request, url, controller.signal, fiber) : flatMap3(addFinalizer(scope, sync2(() => controller.abort())), () => f(request, url, controller.signal, fiber));
  const exchange = (request, onResponse) => uninterruptibleMask2((restore) => matchCauseEffect2(restore(send(request)), {
    onSuccess: (response) => {
      response = trackResponse(response, controller, scope !== undefined, urlParamsRedactedNames);
      onResponse?.(response);
      return succeed6(response);
    },
    onFailure: (cause) => {
      if (hasInterrupts2(cause)) {
        controller.abort();
      }
      addFailureRedactedNames(cause, urlParamsRedactedNames);
      return failCause3(cause);
    }
  }));
  const tracerDisabled = fiber.getRef(DisablePropagation) || fiber.getRef(TracerDisabledWhen)(request);
  if (tracerDisabled) {
    return exchange(request);
  }
  return useSpan2(fiber.getRef(SpanNameGenerator)(request), {
    kind: "client"
  }, (span) => {
    span.attribute("http.request.method", request.method);
    const redactedHeaderNames = fiber.getRef(CurrentRedactedNames);
    addUrlAttributes(span, url, redactedNames(request.urlParams, urlParamsRedactedNames));
    const headerFilter = fiber.getRef(TracerHeaderFilter);
    addHeaderAttributes(span, "request", request.headers, headerFilter, redactedHeaderNames);
    request = fiber.getRef(TracerPropagationEnabled) ? setHeaders(request, toHeaders(span)) : request;
    return withParentSpan2(exchange(request, (response) => {
      span.attribute("http.response.status_code", response.status);
      addHeaderAttributes(span, "response", response.headers, headerFilter, redactedHeaderNames);
      if (response.status >= 400 && response.status < 600) {
        span.attribute("error.type", String(response.status));
        endSpanWithStatusError(fiber, span, request, response);
      }
    }), span, {
      captureStackTrace: false
    });
  });
})), succeed6);
var endSpanWithStatusError = (fiber, span, request, response) => {
  const stackTraceLimit = getStackTraceLimit();
  setStackTraceLimit(0);
  let exit;
  try {
    exit = fail5(new HttpClientError({
      reason: new StatusCodeError({
        request,
        response
      })
    }));
  } finally {
    setStackTraceLimit(stackTraceLimit);
  }
  span.end(fiber.getRef(TracerTimingEnabled2) ? fiber.getRef(Clock).currentTimeNanosUnsafe() : BigInt(0), exit);
};
var mapRequestInput = /* @__PURE__ */ dual(2, (self, f) => makeWith2(self.postprocess, (request) => self.preprocess(f(request))));
var TracerDisabledWhen = /* @__PURE__ */ Reference("effect/http/HttpClient/TracerDisabledWhen", {
  defaultValue: () => constFalse
});
var TracerHeaderFilter = /* @__PURE__ */ Reference("effect/http/HttpClient/TracerHeaderFilter", {
  defaultValue: () => constFalse
});
var TracerPropagationEnabled = /* @__PURE__ */ Reference("effect/http/HttpClient/TracerPropagationEnabled", {
  defaultValue: constTrue
});
var SpanNameGenerator = /* @__PURE__ */ Reference("effect/http/HttpClient/SpanNameGenerator", {
  defaultValue: () => (request) => request.method
});
var layerMergedContext = (effect2) => effect(HttpClient)(contextWith2((context) => map6(effect2, (client) => transformResponse(client, updateContext2((input) => merge(context, input))))));
var responseRegistry = /* @__PURE__ */ (() => {
  if ("FinalizationRegistry" in globalThis && globalThis.FinalizationRegistry) {
    const registry = /* @__PURE__ */ new FinalizationRegistry((controller) => {
      try {
        controller.abort();
      } catch {}
    });
    return {
      register(response, controller) {
        registry.register(response, controller, response);
      },
      unregister(response) {
        registry.unregister(response);
      }
    };
  }
  const timers = /* @__PURE__ */ new WeakMap;
  return {
    register(response, controller) {
      timers.set(response, setTimeout(() => controller.abort(), 5000));
    },
    unregister(response) {
      const timer = timers.get(response);
      if (timer === undefined)
        return;
      clearTimeout(timer);
      timers.delete(response);
    }
  };
})();
var RequestScope = /* @__PURE__ */ Reference("effect/http/HttpClient/RequestScope", {
  defaultValue: () => {
    return;
  }
});
var responseControllers = /* @__PURE__ */ new WeakMap;
var trackResponse = (response, controller, scoped, urlParamsRedactedNames) => {
  addResponseRedactedNames(response, urlParamsRedactedNames);
  if (!scoped) {
    responseRegistry.register(response, controller);
    response = new InterruptibleResponse(response, controller);
    addResponseRedactedNames(response, urlParamsRedactedNames);
  }
  responseControllers.set(response, controller);
  return response;
};

class InterruptibleResponse {
  original;
  controller;
  constructor(original, controller) {
    this.original = original;
    this.controller = controller;
  }
  [TypeId36] = TypeId36;
  [TypeId35] = TypeId35;
  applyInterrupt(effect) {
    return suspend2(() => {
      responseRegistry.unregister(this.original);
      return onInterrupt2(effect, () => sync2(() => {
        this.controller.abort();
      }));
    });
  }
  get request() {
    return this.original.request;
  }
  get url() {
    return this.original.url;
  }
  get status() {
    return this.original.status;
  }
  get headers() {
    return this.original.headers;
  }
  get cookies() {
    return this.original.cookies;
  }
  get remoteAddress() {
    return this.original.remoteAddress;
  }
  get formData() {
    return this.applyInterrupt(this.original.formData);
  }
  get text() {
    return this.applyInterrupt(this.original.text);
  }
  get json() {
    return this.applyInterrupt(this.original.json);
  }
  get urlParamsBody() {
    return this.applyInterrupt(this.original.urlParamsBody);
  }
  get arrayBuffer() {
    return this.applyInterrupt(this.original.arrayBuffer);
  }
  get upgrade() {
    return this.applyInterrupt(this.original.upgrade);
  }
  [WebSourceSymbol]() {
    const source = getWebSource(this.original);
    if (source !== undefined)
      responseRegistry.unregister(this.original);
    return source;
  }
  get stream() {
    return suspend4(() => {
      responseRegistry.unregister(this.original);
      return ensuring4(this.original.stream, sync2(() => {
        this.controller.abort();
      }));
    });
  }
  toJSON() {
    return this.original.toJSON();
  }
  [NodeInspectSymbol]() {
    return this.original[NodeInspectSymbol]();
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
}

// ../../node_modules/effect/dist/http/FetchHttpClient.js
var Fetch = /* @__PURE__ */ Reference("effect/http/FetchHttpClient/Fetch", {
  defaultValue: () => globalThis.fetch
});
var StreamBodyFallback = /* @__PURE__ */ Reference("effect/http/FetchHttpClient/StreamBodyFallback", {
  defaultValue: () => "error"
});

class RequestInit extends (/* @__PURE__ */ Service()("effect/http/FetchHttpClient/RequestInit")) {
}
var supportsStreamBody;
var detectStreamBodySupport = () => {
  try {
    let duplexAccessed = false;
    const body = new ReadableStream;
    const request = new Request("https://example.com", {
      method: "POST",
      body,
      get duplex() {
        duplexAccessed = true;
        return "half";
      }
    });
    return (duplexAccessed || request.body === body) && !request.headers.has("Content-Type");
  } catch {
    return false;
  }
};
var fetch = /* @__PURE__ */ make26((request, url, signal, fiber) => {
  if (request.headers.upgrade !== undefined) {
    return fail6(new HttpClientError({
      reason: new TransportError({
        request,
        description: "fetch cannot send an HTTP upgrade request"
      })
    }));
  }
  const fetch = fiber.getRef(Fetch);
  const options = getOrUndefined2(fiber.context, RequestInit) ?? {};
  let headers = options.headers ? merge4(fromInput2(options.headers), request.headers) : request.headers;
  if (headers["content-length"]) {
    headers = remove2(headers, "content-length");
  }
  let uploadController;
  const stopUpload = sync2(() => uploadController?.abort());
  const send = (body) => map6(tryPromise2({
    try: () => fetch(url, {
      ...options,
      method: request.method,
      headers,
      body,
      duplex: typeof ReadableStream !== "undefined" && body instanceof ReadableStream ? "half" : undefined,
      signal: uploadController ? AbortSignal.any([signal, uploadController.signal]) : signal
    }),
    catch: (cause) => new HttpClientError({
      reason: new TransportError({
        request,
        cause
      })
    })
  }), (response) => {
    const original = fromWeb(request, response);
    if (!uploadController)
      return original;
    if (response.body === null)
      uploadController.abort();
    return Object.create(original, {
      ...Object.fromEntries(["arrayBuffer", "text", "json", "formData", "urlParamsBody"].map((key) => [key, {
        get: () => ensuring2(original[key], stopUpload)
      }])),
      stream: {
        get: () => ensuring4(original.stream, stopUpload)
      }
    });
  }).pipe(onError2(() => stopUpload));
  switch (request.body._tag) {
    case "Raw":
    case "Uint8Array":
      return send(request.body.body);
    case "FormData":
      return send(request.body.formData);
    case "Stream": {
      supportsStreamBody ??= detectStreamBodySupport();
      if (supportsStreamBody) {
        uploadController = new AbortController;
        const uploadSignal = AbortSignal.any([signal, uploadController.signal]);
        const stopped = callback2((resume) => {
          const onAbort = () => resume(interrupt3);
          if (uploadSignal.aborted) {
            onAbort();
            return;
          }
          uploadSignal.addEventListener("abort", onAbort, {
            once: true
          });
          return sync2(() => uploadSignal.removeEventListener("abort", onAbort));
        });
        return flatMap3(toReadableStreamEffect(interruptWhen2(request.body.stream, stopped)), send);
      }
      if (fiber.getRef(StreamBodyFallback) === "error") {
        return fail6(new HttpClientError({
          reason: new EncodeError2({
            request,
            description: "Streaming request bodies are not supported in this runtime"
          })
        }));
      }
      return mkArrayBuffer(request.body.stream).pipe(mapError2((cause) => new HttpClientError({
        reason: new EncodeError2({
          request,
          cause
        })
      })), flatMap3(send));
    }
  }
  return send(undefined);
});
var layer3 = /* @__PURE__ */ layerMergedContext(/* @__PURE__ */ succeed6(fetch));
// db/postgres-connection-url.ts
var normalizePostgresConnectionUrl = (connectionString) => {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
};

// e2e/coordination/allocation.ts
var allocationPoolName = "dotypos-sandbox";
var supportedAllocationConcurrency = 3;
var positiveInteger = Int.check(isGreaterThan2(0));
var allocationShard = positiveInteger.check(isLessThanOrEqualTo3(supportedAllocationConcurrency));
var AllocationOwner = Struct({
  repository: NonEmptyString,
  runAttempt: positiveInteger,
  runId: positiveInteger
});
var AllocationRequest = Struct({
  ...AllocationOwner.fields,
  allocatedShard: NullOr(allocationShard),
  preferredShard: allocationShard,
  previewBranch: NullOr(NonEmptyString),
  queuePosition: positiveInteger
});
var allocationOwnerKey = (owner) => `${owner.repository}:${owner.runId}:${owner.runAttempt}`;
var assignQueuedAllocationRequests = ({
  requests,
  shardCount
}) => {
  const allocated = requests.filter(({ allocatedShard }) => allocatedShard !== null);
  const occupiedShards = new Set(allocated.map(({ allocatedShard }) => allocatedShard));
  const occupiedPreviewBranches = new Set(allocated.map(({ previewBranch }) => previewBranch));
  const assignments = [];
  for (const request of requests.filter(({ allocatedShard }) => allocatedShard === null).toSorted((left, right) => left.queuePosition - right.queuePosition)) {
    const { previewBranch } = request;
    if (previewBranch !== null && occupiedPreviewBranches.has(previewBranch)) {
      continue;
    }
    for (let offset = 0;offset < shardCount; offset += 1) {
      const shard = (request.preferredShard - 1 + offset) % shardCount + 1;
      if (occupiedShards.has(shard))
        continue;
      occupiedShards.add(shard);
      occupiedPreviewBranches.add(previewBranch);
      assignments.push({ owner: request, shard });
      break;
    }
  }
  return assignments;
};

// e2e/coordination/allocation.repository.ts
class AllocationStoreError extends TaggedError2("AllocationStoreError") {
  static fromCause = (cause) => cause instanceof AllocationStoreError ? cause : new AllocationStoreError({
    cause,
    message: "Workspace E2E allocation store operation failed."
  });
}

class AllocationRepository extends Service()("WorkspaceE2E/AllocationRepository") {
  static Default = effect(this, gen2(function* () {
    const sql = yield* PgClient;
    const listOwners = sql`
        select
          repository,
          run_id::double precision as "runId",
          run_attempt as "runAttempt"
        from workspace_e2e_coordination.allocation_requests
        where pool_name = ${allocationPoolName}
      `.pipe(mapError2(AllocationStoreError.fromCause));
    const acquire = fn2("AllocationRepository.acquire")(function* (input) {
      return yield* runSerializedTransaction(sql, gen2(function* () {
        const shardCount = yield* lockAllocationPool(sql);
        yield* deleteTerminalOwners(sql, input.terminalOwners);
        yield* sql`
                insert into workspace_e2e_coordination.allocation_requests (
                  pool_name,
                  repository,
                  run_id,
                  run_attempt,
                  preferred_shard,
                  preview_branch
                ) values (
                  ${allocationPoolName},
                  ${input.owner.repository},
                  ${input.owner.runId},
                  ${input.owner.runAttempt},
                  ${input.preferredShard},
                  ${input.previewBranch}
                )
                on conflict (pool_name, repository, run_id, run_attempt)
                do update set last_observed_at = clock_timestamp()
              `;
        const requests = yield* listRequests(sql);
        const assignments = assignQueuedAllocationRequests({
          requests,
          shardCount
        });
        yield* persistAssignments(sql, assignments);
        const self = allocationOwnerKey(input.owner);
        const existing = requests.find((request) => allocationOwnerKey(request) === self)?.allocatedShard;
        return existing ?? assignments.find(({ owner }) => allocationOwnerKey(owner) === self)?.shard;
      }));
    });
    const release = fn2("AllocationRepository.release")(function* (input) {
      yield* runSerializedTransaction(sql, gen2(function* () {
        const shardCount = yield* lockAllocationPool(sql);
        yield* deleteTerminalOwners(sql, input.terminalOwners);
        yield* deleteOwner(sql, input.owner);
        const requests = yield* listRequests(sql);
        yield* persistAssignments(sql, assignQueuedAllocationRequests({ requests, shardCount }));
      }));
    });
    return { acquire, listOwners, release };
  }));
}
var runSerializedTransaction = (sql, operation) => sql.withTransaction(all2([
  sql`set transaction isolation level serializable`,
  sql`set local statement_timeout = '30s'`,
  sql`set local idle_in_transaction_session_timeout = '30s'`
], { discard: true }).pipe(andThen2(operation))).pipe(retry2({
  schedule: exponential("25 millis"),
  times: 5,
  while: isRetryableSqlError
}), mapError2(AllocationStoreError.fromCause));
var isRetryableSqlError = (error) => Boolean(error && typeof error === "object" && "reason" in error && typeof error.reason === "object" && error.reason !== null && "isRetryable" in error.reason && error.reason.isRetryable === true);
var lockAllocationPool = fn2("AllocationRepository.lockPool")(function* (sql) {
  const rows = yield* sql`
      select shard_count as "shardCount"
      from workspace_e2e_coordination.allocation_pools
      where name = ${allocationPoolName}
      for update
    `;
  const pool = rows[0];
  if (!pool) {
    return yield* new AllocationStoreError({
      message: "Workspace E2E allocation pool is not provisioned."
    });
  }
  return pool.shardCount;
});
var listRequests = (sql) => sql`
    select
      allocated_shard as "allocatedShard",
      preferred_shard as "preferredShard",
      preview_branch as "previewBranch",
      queue_position::double precision as "queuePosition",
      repository,
      run_attempt as "runAttempt",
      run_id::double precision as "runId"
    from workspace_e2e_coordination.allocation_requests
    where pool_name = ${allocationPoolName}
    order by queue_position
  `;
var deleteTerminalOwners = (sql, owners) => forEach2(owners, (owner) => deleteOwner(sql, owner), {
  discard: true
});
var deleteOwner = (sql, owner) => sql`
    delete from workspace_e2e_coordination.allocation_requests
    where pool_name = ${allocationPoolName}
      and repository = ${owner.repository}
      and run_id = ${owner.runId}
      and run_attempt = ${owner.runAttempt}
  `;
var persistAssignments = (sql, assignments) => forEach2(assignments, ({ owner, shard }) => sql`
        update workspace_e2e_coordination.allocation_requests
        set
          allocated_shard = ${shard},
          acquired_at = clock_timestamp(),
          last_observed_at = clock_timestamp()
        where pool_name = ${allocationPoolName}
          and repository = ${owner.repository}
          and run_id = ${owner.runId}
          and run_attempt = ${owner.runAttempt}
          and allocated_shard is null
      `, { discard: true });

// e2e/coordination/config.ts
class AllocationRuntimeConfig extends Service()("WorkspaceE2E/AllocationRuntimeConfig") {
  static layer = (config) => succeed5(this, config);
}

// e2e/coordination/github-run-status.service.ts
var WorkflowRun = Struct({ status: String4 });

class GithubRunStatusService extends Service()("WorkspaceE2E/GithubRunStatusService") {
  static Default = effect(this, gen2(function* () {
    const config = yield* AllocationRuntimeConfig;
    const httpClient = yield* HttpClient;
    const authenticatedClient = httpClient.pipe(mapRequestInput((request) => request.pipe(setHeaders({
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${value2(config.githubToken)}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }))));
    const isTerminal = fn2("GithubRunStatusService.isTerminal")(function* (owner) {
      const response = yield* authenticatedClient.get(githubRunAttemptUrl(config.githubApiUrl, owner));
      if (response.status === 404)
        return false;
      const run = yield* response.pipe(filterStatusOk, flatMap3(schemaBodyJson(WorkflowRun)));
      return run.status === "completed";
    });
    return {
      isTerminal: (owner) => isTerminal(owner).pipe(orElseSucceed2(() => false))
    };
  }));
}
var githubRunAttemptUrl = (githubApiUrl, owner) => `${githubApiUrl}/repos/${owner.repository}/actions/runs/${owner.runId}/attempts/${owner.runAttempt}`;

// e2e/coordination/allocation.service.ts
class AllocationError extends TaggedError2("AllocationError") {
}

class AllocationService extends Service()("WorkspaceE2E/AllocationService") {
  static Default = effect(this, gen2(function* () {
    const repository = yield* AllocationRepository;
    const runStatus = yield* GithubRunStatusService;
    const terminalOwners = fn2("AllocationService.terminalOwners")(function* () {
      const owners = yield* repository.listOwners;
      const terminal = yield* forEach2(owners, (owner) => runStatus.isTerminal(owner).pipe(map6((isTerminal) => ({ isTerminal, owner }))), { concurrency: "unbounded" });
      return terminal.flatMap(({ isTerminal, owner }) => isTerminal ? [owner] : []);
    });
    const release = fn2("AllocationService.release")(function* (owner) {
      const completed = yield* terminalOwners();
      yield* repository.release({ owner, terminalOwners: completed });
    }, mapError2((cause) => new AllocationError({
      cause,
      message: "Workspace E2E allocation release failed."
    })));
    const acquire = fn2("AllocationService.acquire")(function* (input) {
      const attempt = Do2.pipe(bind3("terminalOwners", terminalOwners), bind3("shard", ({ terminalOwners: completed }) => repository.acquire({
        owner: input.owner,
        preferredShard: input.preferredShard,
        previewBranch: input.previewBranch,
        terminalOwners: completed
      })), map6(({ shard: shard2 }) => shard2));
      const shard = yield* attempt.pipe(repeat2({
        schedule: spaced("10 seconds"),
        until: (value) => value !== undefined
      }), timeoutOrElse2({
        duration: `${input.waitSeconds} seconds`,
        orElse: () => fail6(new AllocationError({
          message: "Workspace E2E allocation timed out: all 3 shards remained leased for supported concurrency 3, or another run kept this branch's preview database."
        }))
      }));
      if (shard === undefined) {
        return yield* die3(new Error("Workspace E2E allocation repeat ended without a shard"));
      }
      return shard;
    }, mapError2((cause) => cause instanceof AllocationError ? cause : new AllocationError({
      cause,
      message: "Workspace E2E allocation acquisition failed."
    })));
    return { acquire, release };
  }));
}
var releaseAllocationOnFailure = (operation, release) => operation.pipe(onExit2((exit) => isSuccess3(exit) ? void_4 : release));

// scripts/workspace-e2e-allocation.ts
var positiveIntegerFromString = FiniteFromString.check(isInt()).check(isGreaterThan2(0));
var allocationShardFromString = positiveIntegerFromString.check(isLessThanOrEqualTo3(supportedAllocationConcurrency));
var Environment = Struct({
  GITHUB_API_URL: NonEmptyString,
  GITHUB_OUTPUT: NonEmptyString,
  GITHUB_REPOSITORY: String4.check(isPattern2(/^[^/\s]+\/[^/\s]+$/)),
  GITHUB_RUN_ATTEMPT: positiveIntegerFromString,
  GITHUB_RUN_ID: positiveIntegerFromString,
  WORKSPACE_E2E_ALLOCATION_MODE: Literals(["acquire", "release"]),
  WORKSPACE_E2E_ALLOCATION_PREFERRED_SHARD: allocationShardFromString,
  WORKSPACE_E2E_ALLOCATION_PREVIEW_BRANCH: String4,
  WORKSPACE_E2E_ALLOCATION_TOKEN: NonEmptyString,
  WORKSPACE_E2E_ALLOCATION_WAIT_SECONDS: positiveIntegerFromString,
  WORKSPACE_E2E_COORDINATOR_DATABASE_URL: NonEmptyString
});
var run2 = fn2("WorkspaceE2EAllocation.run")(function* (environment) {
  const allocation = yield* AllocationService;
  const owner = {
    repository: environment.GITHUB_REPOSITORY,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    runId: environment.GITHUB_RUN_ID
  };
  if (environment.WORKSPACE_E2E_ALLOCATION_MODE === "release") {
    yield* allocation.release(owner);
    return;
  }
  const previewBranch = environment.WORKSPACE_E2E_ALLOCATION_PREVIEW_BRANCH;
  if (previewBranch === "") {
    return yield* new AllocationError({
      message: "Workspace E2E allocation needs the preview branch to acquire."
    });
  }
  const acquireAndPublish = allocation.acquire({
    owner,
    preferredShard: environment.WORKSPACE_E2E_ALLOCATION_PREFERRED_SHARD,
    previewBranch,
    waitSeconds: environment.WORKSPACE_E2E_ALLOCATION_WAIT_SECONDS
  }).pipe(tap2((shard) => tryPromise2({
    try: () => appendFile(environment.GITHUB_OUTPUT, `shard=${shard}
`, "utf8"),
    catch: (cause) => new AllocationError({
      cause,
      message: cause instanceof Error ? cause.message : "Workspace E2E allocation failed."
    })
  })), tap2((shard) => log(`Workspace E2E allocation acquired shard ${shard} of ${supportedAllocationConcurrency}`)));
  yield* releaseAllocationOnFailure(acquireAndPublish, allocation.release(owner));
});
var program = decodeUnknownEffect2(Environment)(process.env).pipe(flatMap3((environment) => {
  const runtimeConfig = AllocationRuntimeConfig.layer({
    githubApiUrl: environment.GITHUB_API_URL,
    githubToken: make10(environment.WORKSPACE_E2E_ALLOCATION_TOKEN)
  });
  const repository = AllocationRepository.Default.pipe(provide2(layer2({
    applicationName: "workspace-e2e-allocation",
    connectTimeout: "10 seconds",
    maxConnections: 1,
    url: make10(normalizePostgresConnectionUrl(environment.WORKSPACE_E2E_COORDINATOR_DATABASE_URL))
  })));
  const runStatus = GithubRunStatusService.Default.pipe(provide2(merge2(runtimeConfig, layer3)));
  const allocation = AllocationService.Default.pipe(provide2(merge2(repository, runStatus)));
  return run2(environment).pipe(provide4(allocation));
}), tapError2((error) => logError(error instanceof Error ? error.message : "Workspace E2E allocation failed.")));
runMain2(program, { disableErrorReporting: true });
