import { describe, expect, it } from "vitest";
import { splitMigration, validateSequence } from "./migration-files";

describe("splitMigration", () => {
  it("splits on the -- up and -- down markers", () => {
    const { up, down } = splitMigration(`-- up\nCREATE TABLE t (id int);\n\n-- down\nDROP TABLE t;\n`);
    expect(up).toBe("CREATE TABLE t (id int);");
    expect(down).toBe("DROP TABLE t;");
  });

  it("accepts marker casing and spacing variants", () => {
    const { up, down } = splitMigration(`--UP\nselect 1;\n--  Down  \nselect 2;`);
    expect(up).toBe("select 1;");
    expect(down).toBe("select 2;");
  });

  it("rejects a file without a down section", () => {
    expect(() => splitMigration("-- up\nselect 1;", "0007_x.sql")).toThrow(/0007_x.sql: missing "-- down"/);
  });

  it("rejects an empty down section", () => {
    expect(() => splitMigration("-- up\nselect 1;\n-- down\n")).toThrow(/empty "-- down"/);
  });

  it("rejects down before up", () => {
    expect(() => splitMigration("-- down\nselect 2;\n-- up\nselect 1;")).toThrow(/must come after/);
  });
});

describe("validateSequence", () => {
  it("returns names sorted by number", () => {
    expect(validateSequence(["0002_b.sql", "0001_a.sql"])).toEqual(["0001_a.sql", "0002_b.sql"]);
  });

  it("accepts an empty migrations folder", () => {
    expect(validateSequence([])).toEqual([]);
  });

  it("rejects a gap", () => {
    expect(() => validateSequence(["0001_a.sql", "0003_c.sql"])).toThrow(/gap.*expected 0002/);
  });

  it("rejects a duplicate number", () => {
    expect(() => validateSequence(["0001_a.sql", "0001_b.sql"])).toThrow(/duplicate/);
  });

  it("rejects a badly named file", () => {
    expect(() => validateSequence(["1_a.sql"])).toThrow(/expected NNNN_snake_name/);
  });
});
