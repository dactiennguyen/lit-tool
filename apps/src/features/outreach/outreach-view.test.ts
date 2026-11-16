import { describe, expect, it } from "vitest";
import { fillTemplate, liveSenders, type TemplateUser } from "./outreach-view";

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

describe("liveSenders", () => {
  const senders = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];

  it("keeps only accounts that are both selected and logged in", () => {
    expect(liveSenders(senders, ["a", "b"], () => true)).toHaveLength(2);
  });

  it("drops an account that logged out mid-run", () => {
    expect(liveSenders(senders, ["a", "b"], (id) => id === "a")).toEqual([{ id: "a", label: "A" }]);
  });

  it("drops an account that was unticked mid-run", () => {
    expect(liveSenders(senders, ["a"], () => true)).toEqual([{ id: "a", label: "A" }]);
  });

  it("returns none when all senders logged out or were cleared", () => {
    expect(liveSenders(senders, ["a", "b"], () => false)).toEqual([]);
    expect(liveSenders(senders, [], () => true)).toEqual([]);
  });
});
