import { describe, expect, it } from "vitest";
import { fillTemplate, type TemplateUser } from "./outreach-view";

const linh: TemplateUser = {
  nickname: "Linh",
  age: 21,
  gender: "girl",
  ipCity: "Hà Nội",
  country: "VN",
  ipCountry: null,
  litId: 123,
};
const blank: TemplateUser = {
  nickname: null,
  age: null,
  gender: null,
  ipCity: null,
  country: null,
  ipCountry: null,
  litId: null,
};

describe("fillTemplate", () => {
  it("fills name variants and falls back to 'bạn'", () => {
    expect(fillTemplate("Hi {ten}", linh)).toBe("Hi Linh");
    expect(fillTemplate("Hi {username}", linh)).toBe("Hi Linh");
    expect(fillTemplate("Hi {Name}", linh)).toBe("Hi Linh");
    expect(fillTemplate("Hi {ten}", blank)).toBe("Hi bạn");
  });

  it("fills age, gender, location and id", () => {
    expect(fillTemplate("{tuoi} tuổi", linh)).toBe("21 tuổi");
    expect(fillTemplate("{gioitinh}", linh)).toBe("Nữ");
    expect(fillTemplate("{noio}", linh)).toBe("Hà Nội, VN");
    expect(fillTemplate("ID {id}", linh)).toBe("ID 123");
  });

  it("leaves unknown tokens and tolerates spaces in braces", () => {
    expect(fillTemplate("{ foo }", linh)).toBe("{ foo }");
    expect(fillTemplate("Hi { ten }", linh)).toBe("Hi Linh");
  });

  it("drops missing optional fields to empty", () => {
    expect(fillTemplate("{tuoi}{gioitinh}{noio}{id}", blank)).toBe("");
  });
});
