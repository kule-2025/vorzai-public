// Fully standalone ambient module declaration for 'zod'.
// Classic node moduleResolution cannot traverse package.json 'exports',
// so we declare everything inline. At runtime, require('zod') works fine.

declare module 'zod' {
  // ============ Core types (minimal, covers all usage in routes/services) ============
  type Primitive = string | number | boolean | bigint | symbol | undefined | null;
  type ZodRawShape = Record<string, ZodTypeAny | Function | object>;

  /**
   * Discriminated union for safeParse results.
   *
   * NOTE: these MUST be declared as named interfaces rather than inline object
   * literals. When the union was written inline on the method signature, TypeScript
   * failed to narrow it via `if (!parsed.success)` and every `parsed.error` access
   * in the route layer errored with TS2339.
   */
  interface SafeParseSuccess {
    success: true;
    data: any;
    error?: undefined;
  }
  interface SafeParseFailure {
    success: false;
    data?: undefined;
    error: ZodErrorClass;
  }
  type SafeParseResult = SafeParseSuccess | SafeParseFailure;

  interface ZodType {
    _type: any;
    _output: any;
    parse(data: unknown): any;
    safeParse(data: unknown): SafeParseResult;
    parseAsync(data: unknown): Promise<any>;
    safeParseAsync(data: unknown): Promise<SafeParseResult>;
    optional(): ZodOptional<this>;
    nullable(): ZodNullable<this>;
    default(value: any): ZodDefault<this>;
    describe(description: string): this;
    pipe(target: any): ZodPipeline<this, any>;
  }

  type ZodTypeAny = ZodType & { _output: any };

  /**
   * 校验参数：真实 zod 允许直接传字符串作为错误消息，
   * 也允许传 { message } 对象或自定义 errorMap 对象。
   */
  type ZodParams = string | object;

  interface ZodString extends ZodType {
    email(params?: ZodParams): ZodString;
    url(params?: ZodParams): ZodString;
    uuid(params?: ZodParams): ZodString;
    cuid(params?: ZodParams): ZodString;
    datetime(params?: ZodParams): ZodString;
    ip(params?: ZodParams): ZodString;
    emoji(params?: ZodParams): ZodString;
    min(minLength: number, params?: ZodParams): ZodString;
    max(maxLength: number, params?: ZodParams): ZodString;
    length(len: number, params?: ZodParams): ZodString;
    regex(regex: RegExp, params?: ZodParams): ZodString;
    startsWith(value: string, params?: ZodParams): ZodString;
    endsWith(value: string, params?: ZodParams): ZodString;
    includes(value: string, params?: ZodParams): ZodString;
    /** 去除首尾空白（真实 zod 支持，此前垫片缺失） */
    trim(): ZodString;
    toLowerCase(): ZodString;
    toUpperCase(): ZodString;
    nonempty(params?: ZodParams): ZodString;
    optional(): ZodOptional<ZodString>;
    nullable(): ZodNullable<ZodString>;
    default(value: string): ZodDefault<ZodString>;
    transform(fn: (arg: string) => any): ZodEffects<ZodString, any>;
    refine(check: (arg: string) => boolean | Promise<boolean>, params?: ZodParams): ZodEffects<ZodString, string>;
  }

  interface ZodNumber extends ZodType {
    int(params?: ZodParams): ZodNumber;
    min(minValue: number, params?: ZodParams): ZodNumber;
    max(maxValue: number, params?: ZodParams): ZodNumber;
    gt(value: number, params?: ZodParams): ZodNumber;
    gte(value: number, params?: ZodParams): ZodNumber;
    lt(value: number, params?: ZodParams): ZodNumber;
    lte(value: number, params?: ZodParams): ZodNumber;
    positive(params?: ZodParams): ZodNumber;
    negative(params?: ZodParams): ZodNumber;
    nonnegative(params?: ZodParams): ZodNumber;
    nonpositive(params?: ZodParams): ZodNumber;
    multipleOf(value: number, params?: ZodParams): ZodNumber;
    step(value: number, params?: ZodParams): ZodNumber;
    finite(params?: ZodParams): ZodNumber;
    safe(params?: ZodParams): ZodNumber;
    optional(): ZodOptional<ZodNumber>;
    nullable(): ZodNullable<ZodNumber>;
    default(value: number): ZodDefault<ZodNumber>;
    transform(fn: (arg: number) => any): ZodEffects<ZodNumber, any>;
    refine(check: (arg: number) => boolean | Promise<boolean>, params?: ZodParams): ZodEffects<ZodNumber, number>;
  }

  interface ZodBoolean extends ZodType {
    optional(): ZodOptional<ZodBoolean>;
    default(value: boolean): ZodDefault<ZodBoolean>;
  }

  interface ZodObject<T extends ZodRawShape> extends ZodType {
    partial(): ZodObject<{ [K in keyof T]: ZodOptional<T[K]> }>;
    deepPartial(): ZodObject<{ [K in keyof T]: T[K] extends ZodArray<infer U> ? T[K] : ZodOptional<T[K]> }>;
    pick<K extends keyof T>(keys: K[]): ZodObject<{ [K2 in K]: T[K2] }>;
    omit<K extends keyof T>(keys: K[]): ZodObject<{ [K2 in Exclude<keyof T, K>]: T[K2] }>;
    extend<U extends ZodRawShape>(shape: U): ZodObject<T & U>;
    passthrough(): ZodObject<T>;
    strict(): ZodObject<T>;
    strip(): ZodObject<T>;
    keyof(): ZodEnum<Extract<keyof T, string>[]>;
  }

  interface ZodArray<T> extends ZodType {
    min(minLength: number, params?: ZodParams): ZodArray<T>;
    max(maxLength: number, params?: ZodParams): ZodArray<T>;
    nonempty(): ZodArray<T>;
    element<T2>(schema: T2): ZodArray<T2>;
    unique(): ZodArray<T>;
  }

  interface ZodEnum<T extends string[]> extends ZodType {
    optional(): ZodOptional<ZodEnum<T>>;
    nullable(): ZodNullable<ZodEnum<T>>;
    default(value: T[number]): ZodDefault<ZodEnum<T>>;
    readonly options: T;
  }

  interface ZodRecord<K extends ZodType = ZodString, V extends ZodType = ZodType> extends ZodType {}

  interface ZodUnion<T extends ZodType[]> extends ZodType {}

  interface ZodOptional<T extends ZodType> extends ZodType {
    unwrap(): T;
  }

  interface ZodNullable<T extends ZodType> extends ZodType {
    unwrap(): T;
  }

  interface ZodDefault<T extends ZodType> extends ZodType {
    unwrap(): T;
  }

  interface ZodEffects<T extends ZodType, Output = any> extends ZodType {
    superRefine(refine: (data: Output, ctx: any) => void | Promise<void>): ZodEffects<T, Output>;
    meta(meta: Record<string, unknown>): ZodEffects<T, Output>;
  }

  interface ZodNullable<T extends ZodType> extends ZodType {}

  // Pipeline
  interface ZodPipeline<In extends ZodType, Out extends ZodType> extends ZodType {}

  // ============ ZodError ============
  class ZodErrorClass extends Error {
    name: string;
    message: string;
    issues: { path: (string | number)[]; message: string; code: string; }[];
    errors: { path: (string | number)[]; message: string }[];
    addIssue(issue: any): void;
    addIssues(issues: any[]): void;
    constructor(issues: any[]);
  }
  type ZodError = ZodErrorClass;

  // ============ The 'z' factory namespace (runtime: z.string(), z.object(), etc.) ============
  const z: {
    string(params?: ZodParams): ZodString;
    number(params?: ZodParams): ZodNumber;
    boolean(params?: ZodParams): ZodBoolean;
    bigint(params?: ZodParams): ZodType;
    symbol(params?: ZodParams): ZodType;
    date(params?: ZodParams): ZodType;
    array<T extends ZodType>(schema: T): ZodArray<T>;
    object<T extends ZodRawShape>(shape: T): ZodObject<T>;
    record<K extends ZodType, V extends ZodType>(keyType?: K, valueType?: V): ZodRecord<K, V>;
    union<T extends ZodType[]>(schemas: T): ZodUnion<T>;
    discriminatedUnion(discriminator: string, options: ZodType[]): ZodType;
    intersection<T extends ZodType, U extends ZodType>(a: T, b: U): ZodType;
    tuple<T extends ZodType[]>(schemas: T): ZodType;
    null(params?: ZodParams): ZodType;
    never(params?: ZodParams): ZodType;
    void(params?: ZodParams): ZodType;
    unknown(params?: ZodParams): ZodType;
    any(params?: ZodParams): ZodType;
    literal<T extends Primitive>(value: T, params?: ZodParams): ZodType;
    /** 支持 as const 只读元组与普通数组两种写法 */
    enum<T extends string>(values: readonly T[], params?: ZodParams): ZodEnum<T[]>;
    nativeEnum<T>(enumObject: T, params?: ZodParams): ZodType;
    lazy<T extends ZodType>(getter: () => T): T;
    pipeline<In extends ZodType, Out extends ZodType>(a: In, b: Out): ZodPipeline<In, Out>;
    /**
     * 类型强制转换命名空间。真实 zod 里 coerce 是对象而非函数，
     * 用于把 query string 等文本自动转成目标类型：z.coerce.number()
     */
    coerce: {
      string(params?: ZodParams): ZodString;
      number(params?: ZodParams): ZodNumber;
      boolean(params?: ZodParams): ZodBoolean;
      bigint(params?: ZodParams): ZodType;
      date(params?: ZodParams): ZodType;
    };
    preprocess<T extends ZodType>(transform: (arg: any) => any, schema: T): ZodEffects<ZodType, T["_output"]>;
    format(schema: ZodType): ZodType;
    templateLiteral<S>(schema: S): ZodType;
    branded(): ZodType;
    catch<T extends ZodType>(schema: T, defaultValue: any): ZodType;
    transform<T extends ZodType>(schema: T, transform: (arg: any) => any): ZodEffects<T, any>;
    register(ctx: any, target: any): any;
    createParser(schema: ZodType): (data: unknown) => any;
    custom<T>(check: (val: unknown) => boolean | Promise<boolean>, params?: ZodParams): ZodType;
    file(): ZodType;
    uploadFile(): ZodType;
    uploadFiles(): ZodArray<ZodType>;
    nanoid(): ZodType;
    ulid(): ZodType;
    uuid(): ZodString;
    cuid(): ZodString;
    cuid2(): ZodString;
    emi(): ZodString;
  };

  export { ZodError, z };
  export type {
    ZodType, ZodTypeAny,
    ZodString, ZodNumber, ZodBoolean,
    ZodObject, ZodArray, ZodEnum,
    ZodRecord, ZodUnion, ZodOptional,
    ZodNullable, ZodDefault, ZodEffects,
    ZodPipeline, ZodRawShape,
  };
}
