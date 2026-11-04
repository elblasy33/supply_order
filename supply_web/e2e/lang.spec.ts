import { expect, test } from "@playwright/test";
import { pickOdooLang } from "../src/lib/i18n/core";

test("the Odoo language asked for is one that Odoo has installed", () => {
  expect(pickOdooLang("ar", ["en_US", "ar_001"])).toBe("ar_001");
  expect(pickOdooLang("ar", ["en_US", "ar_SY"])).toBe("ar_SY"); // no ar_001 on that Odoo: Odoo would reject the request
  expect(pickOdooLang("ar", ["en_US", "fr_FR"])).toBeUndefined(); // nothing close: leave it to Odoo
  expect(pickOdooLang("en", ["fr_FR", "en_GB"])).toBe("en_GB");
  expect(pickOdooLang("en", ["en_US"])).toBe("en_US");
  expect(pickOdooLang("ar", null)).toBeUndefined(); // not learned yet
  expect(pickOdooLang("ar", [])).toBeUndefined();
});
