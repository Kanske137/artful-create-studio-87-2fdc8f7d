// Gemensam ordlista för mallinnehåll: svensk källtext → översättning.
// Gäller alla mallar; en malls egna översättningar (template.i18n, redigeras
// i admin under "Översättningar") vinner över denna. Se src/lib/template-i18n.ts.
//
// Lägg till en rad i en.json, da.json OCH fi.json med samma svenska nyckel.
// Texter som ska vara likadana på alla språk (namn, engelska, latin, ortnamn)
// läggs i same.json så att admin inte visar dem som oöversatta.
// template-strings.test.ts kontrollerar att filerna hänger ihop.
import type { TemplateDictionaries } from "@/lib/template-i18n";
import en from "./en.json";
import da from "./da.json";
import fi from "./fi.json";
import same from "./same.json";

export const TEMPLATE_STRINGS: TemplateDictionaries = { en, da, fi };

export const SAME_IN_ALL_LANGUAGES: ReadonlySet<string> = new Set(same as string[]);
