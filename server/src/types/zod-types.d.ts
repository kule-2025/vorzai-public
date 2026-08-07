declare global {
  namespace zod {
    interface ZodString {
      email(): ZodString;
      url(): ZodString;
      uuid(): ZodString;
      min(minLength: number): ZodString;
      max(maxLength: number): ZodString;
      optional(): ZodOptional<zod.ZodString>;
      default(def: string): ZodDefault<zod.ZodString>;
      regex(regex: RegExp): ZodString;
      transform(fn: (arg: string) => any): ZodEffects<zod.ZodString, any>;
    }
    interface ZodNumber {
      int(): ZodNumber;
      min(min: number): ZodNumber;
      max(max: number): ZodNumber;
      positive(): ZodNumber;
      nonnegative(): ZodNumber;
      optional(): ZodOptional<zod.ZodNumber>;
      default(def: number): ZodDefault<zod.ZodNumber>;
    }
    interface ZodArray<T> {
      min(minLength: number): ZodArray<T>;
      max(maxLength: number): ZodArray<T>;
      nonempty(): ZodArray<T>;
    }
    interface ZodEnum<T extends string[]> {
      optional(): ZodOptional<ZodEnum<T>>;
    }
    interface ZodObject<T> {
      partial(): ZodObject<{ [K in keyof T]: ZodOptional<T[K]> }>;
      deepPartial(): ZodObject<{ [K in keyof T]: T[K] extends zod.ZodArray<infer U> ? ZodArray<U> : T[K] }>;
      pick<T2 extends Partial<keyof T>>(keys: T2): ZodObject<Pick<T, T2[keyof T2]>>;
      omit<T2 extends Partial<keyof T>>(keys: T2): ZodObject<Omit<T, T2[keyof T2]>>;
      extend<T2>(shape: T2): ZodObject<T & T2>;
      passthrough(): ZodObject<{ [K in keyof T]: T[K] }>;
      strict(): ZodObject<T>;
      strip(): ZodObject<T>;
      keyof(): ZodEnum<keyof T[]>;
    }
    interface ZodRecord<K, V> {}
    interface ZodUnion<T> {}
    interface ZodOptional<T> {}
    interface ZodDefault<T> {}
    interface ZodEffects<T, Output = unknown> {
      meta(meta: object): ZodEffects<T, Output>;
    }
    interface ZodNullable<T> {}
    interface ZodEnumValue extends string {}
    interface ZodType {
      _type: any;
    }
    interface ZodRawShape { [key: string]: ZodType | object | Function; }
    interface ZodRecordShape { [key: string]: ZodType; }

    const z: ZodZodType;
    interface ZodZodType {
      string(options?: object): ZodString;
      number(options?: object): ZodNumber;
      boolean(options?: object): ZodBoolean;
      array<T>(schema: T): ZodArray<T>;
      object<T extends ZodRawShape>(shape: T): ZodObject<T>;
      record<T extends ZodType>(valueType: T): ZodRecord<string, T>;
      record<K extends ZodString, V extends ZodType>(keyType: K, valueType: V): ZodRecord<K, V>;
      record(valueType: ZodType): ZodRecord<string, ZodType>;
      unknown(): ZodType;
      literal<T extends string | number | boolean>(value: T): ZodType;
      enum<T extends string[]>(values: T): ZodEnum<T>;
      nativeEnum<T>(enumObject: T): ZodType;
      union<T extends ZodType[]>(schemas: T): ZodUnion<T>;
      discriminatedUnion(discriminator: string, options: ZodType[]): ZodType;
      tuple<T extends ZodType[]>(schemas: T): ZodType;
      null(): ZodType;
      nullable<T extends ZodType>(schema: T): ZodNullable<T>;
      optional<T extends ZodType>(schema: T): ZodOptional<T>;
      default<T extends ZodType>(schema: T, defaultValue: any): ZodDefault<T>;
      date(): ZodType;
      bigint(): ZodType;
      symbol(): ZodType;
      file(): ZodType;
      lazy<T>(getter: () => T): T;
      never(params?: object): ZodType;
      void(): ZodType;
      namespace(): any;
      any(): ZodType;
      never(): ZodType;
    }

    interface ZodBoolean {
      optional(): ZodOptional<ZodBoolean>;
      default(def: boolean): ZodDefault<ZodBoolean>;
    }

    class ZodError {
      errors: { path: (string | number)[]; message: string }[];
      name: string;
      message: string;
      constructor(issues: unknown[]);
    }

    interface ZodResult {
      success: boolean;
      data?: any;
      error?: ZodError;
    }
    interface ZodParseResult {
      success: boolean;
      data?: unknown;
      error?: ZodError;
      changes?: unknown;
    }

    type z = ZodZodType;
  }
}
export {};
