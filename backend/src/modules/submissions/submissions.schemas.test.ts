import { describe, expect, it } from "vitest";
import { createDraftSubmissionSchema } from "./submissions.schemas";

function makePayload() {
  return {
    address: "г. Москва, ул. Пушкина, д. 1",
    phone: "9001234567",
    waterType: "HVS",
    equipmentTypeId: 1,
    customEquipmentTypeName: null,
    factoryNumber: "A12345",
    productionYear: 2020,
    reading: "12.345"
  };
}

describe("createDraftSubmissionSchema", () => {
  it("accepts predefined equipment type id", () => {
    const parsed = createDraftSubmissionSchema.safeParse(makePayload());
    expect(parsed.success).toBe(true);
  });

  it("accepts custom equipment type when equipmentTypeId is null", () => {
    const parsed = createDraftSubmissionSchema.safeParse({
      ...makePayload(),
      equipmentTypeId: null,
      customEquipmentTypeName: "Ультразвуковой импульсный"
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts factory number with special symbols", () => {
    const parsed = createDraftSubmissionSchema.safeParse({
      ...makePayload(),
      factoryNumber: "№12/34-AB(test)_*#"
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects payload without predefined or custom equipment type", () => {
    const parsed = createDraftSubmissionSchema.safeParse({
      ...makePayload(),
      equipmentTypeId: null,
      customEquipmentTypeName: ""
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects payload with both predefined and custom equipment type", () => {
    const parsed = createDraftSubmissionSchema.safeParse({
      ...makePayload(),
      equipmentTypeId: 2,
      customEquipmentTypeName: "Другая модель"
    });
    expect(parsed.success).toBe(false);
  });
});
