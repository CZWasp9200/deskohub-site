// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
// non-recursive definitions
export type Adresa = { readonly "kodStatu"?: string, readonly "nazevStatu"?: string, readonly "kodKraje"?: number, readonly "nazevKraje"?: string, readonly "kodOkresu"?: number, readonly "nazevOkresu"?: string, readonly "kodObce"?: number, readonly "nazevObce"?: string, readonly "kodSpravnihoObvodu"?: number, readonly "nazevSpravnihoObvodu"?: string, readonly "kodMestskehoObvodu"?: number, readonly "nazevMestskehoObvodu"?: string, readonly "kodMestskeCastiObvodu"?: number, readonly "kodUlice"?: number, readonly "nazevMestskeCastiObvodu"?: string, readonly "nazevUlice"?: string, readonly "cisloDomovni"?: number, readonly "doplnekAdresy"?: string, readonly "kodCastiObce"?: number, readonly "cisloOrientacni"?: number, readonly "cisloOrientacniPismeno"?: string, readonly "nazevCastiObce"?: string, readonly "kodAdresnihoMista"?: number, readonly "psc"?: number, readonly "textovaAdresa"?: string, readonly "cisloDoAdresy"?: string, readonly "standardizaceAdresy"?: boolean, readonly "pscTxt"?: string, readonly "typCisloDomovni"?: number }
export const Adresa = Schema.Struct({ "kodStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Kód státu (ciselnikKod: Stat) " })), "nazevStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Název státu" }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "kodKraje": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód kraje" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999).annotate({ "expected": "a value less than or equal to 999" }))), "nazevKraje": Schema.optionalKey(Schema.String.annotate({ "description": "Název kraje" }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "kodOkresu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód okresu", "format": "int32" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(9999).annotate({ "expected": "a value less than or equal to 9999" }))), "nazevOkresu": Schema.optionalKey(Schema.String.annotate({ "description": "Název okresu" }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "kodObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód obce", "format": "int32" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999999).annotate({ "expected": "a value less than or equal to 999999" }))), "nazevObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název obce" }).check(Schema.isMaxCodePoints(48).annotate({ "expected": "a string with at most 48 code points" }))), "kodSpravnihoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód správního obvodu Prahy" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999).annotate({ "expected": "a value less than or equal to 999" }))), "nazevSpravnihoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název správního obvodu Prahy " }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "kodMestskehoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městského obvodu Prahy" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999).annotate({ "expected": "a value less than or equal to 999" }))), "nazevMestskehoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městského obvodu Prahy" }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "kodMestskeCastiObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městské části statutárního města", "format": "int32" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999999).annotate({ "expected": "a value less than or equal to 999999" }))), "kodUlice": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód ulice, veřejného prostranství ze zdroje", "format": "int32" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(9999999).annotate({ "expected": "a value less than or equal to 9999999" }))), "nazevMestskeCastiObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městské části statutárního města " }).check(Schema.isMaxCodePoints(48).annotate({ "expected": "a string with at most 48 code points" }))), "nazevUlice": Schema.optionalKey(Schema.String.annotate({ "description": "Název ulice, veřejného prostranství " }).check(Schema.isMaxCodePoints(48).annotate({ "expected": "a string with at most 48 code points" }))), "cisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo domovní" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(9999).annotate({ "expected": "a value less than or equal to 9999" }))), "doplnekAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Doplňující informace adresního popisu" }).check(Schema.isMaxCodePoints(1500).annotate({ "expected": "a string with at most 1500 code points" }))), "kodCastiObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód časti obce", "format": "int32" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999999).annotate({ "expected": "a value less than or equal to 999999" }))), "cisloOrientacni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo orientační - číselná část" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(999).annotate({ "expected": "a value less than or equal to 999" }))), "cisloOrientacniPismeno": Schema.optionalKey(Schema.String.annotate({ "description": "Číslo orientační - písmenná část" }).check(Schema.isMaxCodePoints(1).annotate({ "expected": "a string with at most 1 code points" }))), "nazevCastiObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název části obce" }).check(Schema.isMaxCodePoints(48).annotate({ "expected": "a string with at most 48 code points" }))), "kodAdresnihoMista": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód adresního místa" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" })).check(Schema.isLessThanOrEqualTo(999999999).annotate({ "expected": "a value less than or equal to 999999999" }))), "psc": Schema.optionalKey(Schema.Number.annotate({ "description": "Poštovní směrovací číslo adresní pošty" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "textovaAdresa": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturovaná adresa (formátovaná adresa)" }).check(Schema.isMaxCodePoints(1500).annotate({ "expected": "a string with at most 1500 code points" }))), "cisloDoAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturované číslo/a použíté v adrese" }).check(Schema.isMaxCodePoints(255).annotate({ "expected": "a string with at most 255 code points" }))), "standardizaceAdresy": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Stav standardizace adresy dle RÚIAN" })), "pscTxt": Schema.optionalKey(Schema.String.annotate({ "description": "Psč zahraničních nebo nestandardně definovaných čísel" })), "typCisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Typ čísla domu - kód (ciselnikKod: TypCislaDomovniho) " }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(9999).annotate({ "expected": "a value less than or equal to 9999" }))) }).annotate({ "description": "Adresa - obecný předek ", "identifier": "Adresa" })
export type AdresaDorucovaci = { readonly "radekAdresy1"?: string, readonly "radekAdresy2"?: string, readonly "radekAdresy3"?: string }
export const AdresaDorucovaci = Schema.Struct({ "radekAdresy1": Schema.optionalKey(Schema.String.annotate({ "description": "1. řádek doručovací adresy" }).check(Schema.isMaxCodePoints(255).annotate({ "expected": "a string with at most 255 code points" }))), "radekAdresy2": Schema.optionalKey(Schema.String.annotate({ "description": "2. řádek doručovací adresy" }).check(Schema.isMaxCodePoints(255).annotate({ "expected": "a string with at most 255 code points" }))), "radekAdresy3": Schema.optionalKey(Schema.String.annotate({ "description": "3. řádek doručovací adresy" }).check(Schema.isMaxCodePoints(255).annotate({ "expected": "a string with at most 255 code points" }))) }).annotate({ "description": "Adresa doručovací dle vyhlášky 359/2011 sb.", "identifier": "AdresaDorucovaci" })
export type SeznamRegistraci = { readonly "stavZdrojeRos"?: string, readonly "stavZdrojeVr"?: string, readonly "stavZdrojeRes"?: string, readonly "stavZdrojeRzp"?: string, readonly "stavZdrojeNrpzs"?: string, readonly "stavZdrojeRpsh"?: string, readonly "stavZdrojeRcns"?: string, readonly "stavZdrojeSzr"?: string, readonly "stavZdrojeDph"?: string, readonly "stavZdrojeSkDph"?: string, readonly "stavZdrojeSd"?: string, readonly "stavZdrojeIr"?: string, readonly "stavZdrojeCeu"?: string, readonly "stavZdrojeRs"?: string, readonly "stavZdrojeRed"?: string, readonly "stavZdrojeMonitor"?: string }
export const SeznamRegistraci = Schema.Struct({ "stavZdrojeRos": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji ROS (Základní registr - Registr osob) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeVr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji VR (Veřejné rejstříky) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRes": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RES (Registr ekonomických subjektů) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRzp": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RŽP (Registr živnostenského podnikání) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeNrpzs": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji NRPZS (Národní registr poskytovatelů zdrovotnických služeb) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRpsh": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RPSH (Registr politických stran a hnutí) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRcns": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RCNS(Registr církví a náboženských společenství) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeSzr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji  SZR(Společný zemědělský registr) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeDph": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji DPH(Registr plátců daně s přidané hodnoty) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeSkDph": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji DPH(Registr plátců daně s přidané hodnoty - skupinové DPH) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeSd": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji SD(Registr plátců spotřební daně) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeIr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji ISIR(Insolvenční rejstřík) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeCeu": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji CEÚ(Centrální evidence úpadců) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRs": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RŠ(Registr škol) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeRed": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RED(Registr evidence dotací) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))), "stavZdrojeMonitor": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji MONITOR(Monitor účetních jednotek státu) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(64).annotate({ "expected": "a string with at most 64 code points" }))) }).annotate({ "description": "Seznam registrací ekonomického subjektu v jednotlivých zdrojích", "identifier": "SeznamRegistraci" })
export type ObchodniJmenoAres = { readonly "platnostOd"?: string, readonly "platnostDo"?: string, readonly "obchodniJmeno"?: string, readonly "primarniZaznam"?: boolean }
export const ObchodniJmenoAres = Schema.Struct({ "platnostOd": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })), "platnostDo": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje do data", "format": "date" })), "obchodniJmeno": Schema.optionalKey(Schema.String.annotate({ "description": "Obchodní jméno ekonomického subjektu" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(2000).annotate({ "expected": "a string with at most 2000 code points" }))), "primarniZaznam": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Primární záznam " })) }).annotate({ "description": "Obchodní jméno s platností", "identifier": "ObchodniJmenoAres" })
export type KodChybyEnum = "OBECNA_CHYBA" | "CHYBA_VSTUPU" | "NENALEZENO" | "NENI_IMPLEMENTOVANO" | "NEPRIHLASENY_UZIVATEL" | "NENI_OPRAVNENI"
export const KodChybyEnum = Schema.Literals(["OBECNA_CHYBA", "CHYBA_VSTUPU", "NENALEZENO", "NENI_IMPLEMENTOVANO", "NEPRIHLASENY_UZIVATEL", "NENI_OPRAVNENI"]).annotate({ "description": "Chybové kódy.", "identifier": "KodChybyEnum" })
export type AdresaAres = { readonly "sidlo"?: Adresa, readonly "primarniZaznam"?: boolean, readonly "platnostOd"?: string, readonly "platnostDo"?: string }
export const AdresaAres = Schema.Struct({ "sidlo": Schema.optionalKey(Adresa), "primarniZaznam": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Primární záznam" })), "platnostOd": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })), "platnostDo": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })) }).annotate({ "description": "Adresa s platností", "identifier": "AdresaAres" })
export type Chyba = { readonly "kod"?: KodChybyEnum, readonly "popis"?: string, readonly "subKod"?: string }
export const Chyba = Schema.Struct({ "kod": Schema.optionalKey(KodChybyEnum), "popis": Schema.optionalKey(Schema.String.annotate({ "description": "Popis chyby" })), "subKod": Schema.optionalKey(Schema.String.annotate({ "description": "Subkod chyby" })) }).annotate({ "identifier": "Chyba" })
export type EkonomickySubjektDalsiUdaje = { readonly "obchodniJmeno"?: ReadonlyArray<ObchodniJmenoAres>, readonly "sidlo"?: ReadonlyArray<AdresaAres>, readonly "pravniForma"?: string, readonly "pravniFormaRos"?: string, readonly "spisovaZnacka"?: string, readonly "datovyZdroj"?: string }
export const EkonomickySubjektDalsiUdaje = Schema.Struct({ "obchodniJmeno": Schema.optionalKey(Schema.Array(ObchodniJmenoAres)), "sidlo": Schema.optionalKey(Schema.Array(AdresaAres)), "pravniForma": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma - kód (ciselnikKod: PravniForma, zdroj: res, com)" }).check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{3}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{3}$" }))), "pravniFormaRos": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma ekonomického subjektu - kód (ciselnikKod: PravniFormaRos, zdroj:res)" }).check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{3}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{3}$" }))), "spisovaZnacka": Schema.optionalKey(Schema.String.annotate({ "description": "Aktuální spisová značka ve tvaru ODDIL xx/SOUD (např. B 100/MSPH) - poskytováno pouze pro zdroj: Veřejné rejstříky" }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" }))), "datovyZdroj": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikace primárního zdroje dat - kód (ciselnikKod: TypZdroje, zdroj: com)" }).check(Schema.isMaxCodePoints(30).annotate({ "expected": "a string with at most 30 code points" }))) }).annotate({ "description": "Další údaje o ekonomickém subjektu", "identifier": "EkonomickySubjektDalsiUdaje" })
export type EkonomickySubjekt = { readonly "ico"?: string, readonly "obchodniJmeno"?: string, readonly "sidlo"?: Adresa, readonly "pravniForma"?: string, readonly "pravniFormaRos"?: string, readonly "financniUrad"?: string, readonly "datumVzniku"?: string, readonly "datumZaniku"?: string, readonly "datumAktualizace"?: string, readonly "dic"?: string, readonly "icoId"?: string, readonly "adresaDorucovaci"?: AdresaDorucovaci, readonly "czNace2008"?: ReadonlyArray<string>, readonly "seznamRegistraci"?: SeznamRegistraci, readonly "primarniZdroj"?: string, readonly "dalsiUdaje"?: ReadonlyArray<EkonomickySubjektDalsiUdaje>, readonly "czNace"?: ReadonlyArray<string>, readonly "subRegistrSzr"?: string, readonly "dicSkDph"?: string }
export const EkonomickySubjekt = Schema.Struct({ "ico": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikační číslo osoby - IČO" }).check(Schema.isMinCodePoints(8).annotate({ "expected": "a string with at least 8 code points" })).check(Schema.isMaxCodePoints(8).annotate({ "expected": "a string with at most 8 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{8}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{8}$" }))), "obchodniJmeno": Schema.optionalKey(Schema.String.annotate({ "description": "Obchodní jméno ekonomického subjektu" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(2000).annotate({ "expected": "a string with at most 2000 code points" }))), "sidlo": Schema.optionalKey(Adresa), "pravniForma": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma - kód (ciselnikKod: PravniForma, zdroj: res, com) " }).check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{3}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{3}$" }))), "pravniFormaRos": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma ekonomického subjektu - kód (ciselnikKod: PravniFormaRos, zdroj:ros)" }).check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{3}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{3}$" }))), "financniUrad": Schema.optionalKey(Schema.String.annotate({ "description": "Správně příslušný finanční úřad - kód (ciselnikKod: FinancniUrad, zdroj:ufo)" }).check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })).check(Schema.isPattern(new globalThis.RegExp("^\\d{3}$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{3}$" }))), "datumVzniku": Schema.optionalKey(Schema.String.annotate({ "description": "Datum vzniku ekonomického subjektu ", "format": "date" })), "datumZaniku": Schema.optionalKey(Schema.String.annotate({ "description": "Datum zániku ekonomického subjektu", "format": "date" })), "datumAktualizace": Schema.optionalKey(Schema.String.annotate({ "description": "Datum aktualizace záznamu", "format": "date" })), "dic": Schema.optionalKey(Schema.String.annotate({ "description": "Daňové identifikační číslo ve formátu CZNNNNNNNNNN" })), "icoId": Schema.optionalKey(Schema.String.annotate({ "description": "Ičo ekonomického subjektu, pokud je ičo přidělené. Id ekonomického subjektu, pokud je ičo nepřidělené." }).check(Schema.isMaxCodePoints(32).annotate({ "expected": "a string with at most 32 code points" })).check(Schema.isPattern(new globalThis.RegExp("^(ARES_)?\\d{8}$", "u")).annotate({ "expected": "a string matching the RegExp ^(ARES_)?\\d{8}$" }))), "adresaDorucovaci": Schema.optionalKey(AdresaDorucovaci), "czNace2008": Schema.optionalKey(Schema.Array(Schema.String.annotate({ "description": "CZ-NACE_2008 ekonomického subjektu - kód (ciselnikKod: CzNace2008, zdroj:res)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(5).annotate({ "expected": "a string with at most 5 code points" })))), "seznamRegistraci": Schema.optionalKey(SeznamRegistraci), "primarniZdroj": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikace primárního zdroje dat." }).check(Schema.isMaxCodePoints(30).annotate({ "expected": "a string with at most 30 code points" }))), "dalsiUdaje": Schema.optionalKey(Schema.Array(EkonomickySubjektDalsiUdaje)), "czNace": Schema.optionalKey(Schema.Array(Schema.String.annotate({ "description": "Seznam CZ-NACE_2025 - seznam ekonomické činnosti - kód (ciselnikKod: CzNace, zdroj:res)" }).check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })).check(Schema.isMaxCodePoints(5).annotate({ "expected": "a string with at most 5 code points" })))), "subRegistrSzr": Schema.optionalKey(Schema.String.annotate({ "description": "Indeftifikátor sub-registru zdroje SZR - kód (ciselnikKod: SubRegistrSzr, zdroj:com)" })), "dicSkDph": Schema.optionalKey(Schema.String.annotate({ "description": "Daňové identifikační číslo skupiny plátce DPH ve formátu CZNNNNNNNNNN" })) }).annotate({ "description": "Základní informace o ekonomickém subjektu - obecný předek", "identifier": "EkonomickySubjekt" })
// schemas
export type VratEkonomickySubjekt200 = EkonomickySubjekt
export const VratEkonomickySubjekt200 = EkonomickySubjekt
export type VratEkonomickySubjekt400 = Chyba
export const VratEkonomickySubjekt400 = Chyba
export type VratEkonomickySubjekt401 = Chyba
export const VratEkonomickySubjekt401 = Chyba
export type VratEkonomickySubjekt403 = Chyba
export const VratEkonomickySubjekt403 = Chyba
export type VratEkonomickySubjekt404 = Chyba
export const VratEkonomickySubjekt404 = Chyba
export type VratEkonomickySubjekt500 = Chyba
export const VratEkonomickySubjekt500 = Chyba

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig | undefined> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse]
  : Config extends { readonly includeResponse?: false | undefined } | undefined ? A
  : A | [A, HttpClientResponse.HttpClientResponse]

export const make = <E, R>(
  httpClient: HttpClient.HttpClient.With<E, R>,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient.With<E, R>) => Effect.Effect<HttpClient.HttpClient.With<E, R>>) | undefined
  } = {}
): AresClient<E, R> => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any, R> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const __encodePathParam = encodeURIComponent
  const __makePathRequest = (
    method: (url: string) => HttpClientRequest.HttpClientRequest,
    parameters: ReadonlyArray<string>,
    getPath: () => string,
  ) => Effect.suspend(() => {
    const fail = (description: string, cause?: unknown) => Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.InvalidUrlError({
          request: method(""),
          cause,
          description,
        }),
      }),
    )
    if (parameters.some((value) => value === "" || /^(?:\.|%2e){1,2}$/i.test(value))) {
      return fail("Path parameters must be non-empty and cannot be dot segments")
    }
    let path: string
    try {
      path = getPath()
    } catch (cause) {
      return fail("Failed to encode path parameter", cause)
    }
    if (path.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
      return fail("Request paths cannot contain dot segments")
    }
    return Effect.succeed(method(path))
  })
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Constraint>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        ),
        (cause) => Effect.fail(AresClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "vratEkonomickySubjekt": (ico, options: Parameters<AresClient["vratEkonomickySubjekt"]>[1]) => __makePathRequest(HttpClientRequest.get, [ico], () => "/ekonomicke-subjekty/" + __encodePathParam(ico) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(VratEkonomickySubjekt200),
      "400": decodeError("VratEkonomickySubjekt400", VratEkonomickySubjekt400),
      "401": decodeError("VratEkonomickySubjekt401", VratEkonomickySubjekt401),
      "403": decodeError("VratEkonomickySubjekt403", VratEkonomickySubjekt403),
      "404": decodeError("VratEkonomickySubjekt404", VratEkonomickySubjekt404),
      "500": decodeError("VratEkonomickySubjekt500", VratEkonomickySubjekt500),
      orElse: unexpectedStatus
    }))
    ))
  )
  }
}

export interface AresClient<E = HttpClientError.HttpClientError, R = never> {
  readonly httpClient: HttpClient.HttpClient.With<E, R>
  /**
* Vyhledání ekonomického subjektu ARES podle zadaného iča
*/
readonly "vratEkonomickySubjekt": {
    <Config extends OperationConfig | undefined = undefined>(ico: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<VratEkonomickySubjekt200, Config>, E | HttpClientError.HttpClientError | SchemaError | AresClientError<"VratEkonomickySubjekt400", VratEkonomickySubjekt400> | AresClientError<"VratEkonomickySubjekt401", VratEkonomickySubjekt401> | AresClientError<"VratEkonomickySubjekt403", VratEkonomickySubjekt403> | AresClientError<"VratEkonomickySubjekt404", VratEkonomickySubjekt404> | AresClientError<"VratEkonomickySubjekt500", VratEkonomickySubjekt500>, R>;
    <Config extends OperationConfig | undefined = undefined>(ico: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<VratEkonomickySubjekt200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | AresClientError<"VratEkonomickySubjekt400", VratEkonomickySubjekt400> | AresClientError<"VratEkonomickySubjekt401", VratEkonomickySubjekt401> | AresClientError<"VratEkonomickySubjekt403", VratEkonomickySubjekt403> | AresClientError<"VratEkonomickySubjekt404", VratEkonomickySubjekt404> | AresClientError<"VratEkonomickySubjekt500", VratEkonomickySubjekt500>, R>;
  }
}

export interface AresClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class AresClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const AresClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): AresClientError<Tag, E> =>
  new AresClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
