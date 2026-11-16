import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result, Schema } from "effect";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

const { PayState, signedPayStateSchema } = await import("./pay-state");
const { openAdvertisedPriceState, sealAdvertisedPriceState } = await import(
  "./advertised-price-state"
);

/*
 * Pay and advertised-price tokens live in open Pay pages and agent links, so
 * their bytes must not change. These tokens were sealed before the sealed
 * state codec was reworked; a change here breaks every token in flight.
 */

const goldenKey = syntheticSealedStateKeyRing(["golden", 9]);
const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly at?: Date } = {}
) => runSealedState(effect, { keys: goldenKey, ...options });
const issuedAt = new Date("2026-06-01T10:00:00.000Z");
const beforeExpiry = () => new Date("2026-06-01T10:09:00.000Z");
const afterExpiry = () => new Date("2026-06-01T10:10:00.000Z");

const encodedPayState = {
  kid: "golden",
  iat: 1780308000,
  exp: 1780308600,
  locale: "en-US",
  orderId: "golden-order-id",
  bookedAt: "2026-06-01T09:58:00.000Z",
  checkoutSessionId: "golden-checkout-session-id",
  acceptedTotal: {
    value: 55000,
    exponent: 2,
    currency: "CZK",
  },
  reservation: {
    kind: "cowork",
    name: "Golden Fixture",
    email: testEmailAddress("golden"),
    phone: "+420 777 000 000",
    billing: {
      purpose: "personal",
      invoice: "none",
    },
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2026-06-20",
  },
  quote: {
    items: [
      {
        type: "cowork",
        tier: "profi",
        amount: {
          value: 55000,
          exponent: 2,
          currency: "CZK",
        },
      },
      {
        type: "coffee",
        amount: {
          value: 0,
          exponent: 2,
          currency: "CZK",
        },
      },
    ],
    fingerprint: "9be3045c",
    payment: {
      expectedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      undiscountedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      discounts: [],
    },
  },
};

const encodedAdvertisedPriceState = {
  kid: "golden",
  iat: 1780308000,
  exp: 1780308600,
  locale: "en-US",
  kind: "cowork",
  reservation: {
    kind: "cowork",
    details: {
      kind: "cowork",
      entryTier: "basic",
      coffee: true,
      date: "2026-06-20",
    },
  },
  quote: {
    items: [
      {
        type: "cowork",
        tier: "basic",
        amount: {
          value: 35000,
          exponent: 2,
          currency: "CZK",
        },
      },
      {
        type: "coffee",
        amount: {
          value: 5000,
          exponent: 2,
          currency: "CZK",
        },
      },
    ],
    fingerprint: "dd5105b3",
    payment: {
      expectedPrice: {
        value: 40000,
        exponent: 2,
        currency: "CZK",
      },
      undiscountedPrice: {
        value: 40000,
        exponent: 2,
        currency: "CZK",
      },
      discounts: [],
    },
  },
};

/** Sealed with a random IV (all bytes 7). */
const payStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.BwcHBwcHBwcHBwcH.Ipnm9gxTxTsQhTvp86xRyh9RZz6iNsNypr4ioMtGsylvnaFNJD3bDNy1tGbk54CC89umLvi98zi8FgTBqR3WW8L1mJTbbpK6-sDDnlNg2kUs78hJYdS9gFHlBAxmuqiOZRSgFnWbNyZF0e2317lZy-37Dp_Bg6M7NuKJJbCjSJ1g9atc_3iOmaExsFe3oC2mWYcu93uJ_Qm2XZj8GnYimnm_PbMUc2dRu0XwJN7rzmKjeig9F4K7GMMYpQQnJJtdVp67U-uHG83g1czTc390kqSc4WcLaj11HWzzW378E9u3hhnA2HhdHKNJG8sbsD7j_rvyXltgyRjiMoMtvbjSwzKaPwCNL7uHI3hous67eQs159qL7DWXbwsYSBrukJWiqRzsgYBcxWf8uu1zB-ixt4Gbglrs4E-aSdUSu_AtQefRFVpbReH6tmTPeu71zvVoZJjjoSUfqsosP5YkmBe972AuX9NWX9T94CIas7KpoIvJAKtA9RU0a_B5ZkWT2Y8voCHaPKXQ5g1O9pDQRIB9ilE7Lo3or-xvvERdSGcIWzgSSfmcF-ermS2WLLS54G6gkmdgxRkG5Pk2WFREoUkS61EW3R1XgzjLXt4uQ0f6gaV06n8LeIRuwIYDmjhQJ0MMlvRBzqzx5nFGHkMnVI3ebVQz7PrYLnHSRTScBkZNCLz99W30y3yC2EPd9CyScntUo_IoSsyN8LaLndqJXzrDiIBG3twFys1oD9p3qW8_P7arDvNBfKvVG5ZZfRCt-I27SZMX5g-PJVp7CCO_Qihxgob_WEW-DNCojdQKgTkLcoTGkDS1otozsQdsN6NgsfRWSnPEZ8XnK1wIipkPpG0i1U4rm7SJ9oIwacvwZ-FGmNhpvUgJAadR32hWN3SXs3NyJUOAG1VEthKVw3hSIeMJZHVJrFY4co09FkGssf3OFFYSNbGFcWbj9R6wkiBMikhFRDj3uFHavxHLEcw6Jk54VzJY7ZzDqBxKdSREe8bSwOXMlGgSwGH6C_YZ1cCwtACKJJ7Oq47OMv1ezx6WhwOsFOtQ6LSSKGz4Fbtivz47km28StnJ9R1mFw4l4AwB09dv6kSWngmYjmilhAyi4ltVZiwja3VXrxCwYSUhYwr6.bIB6PcuU1x9vn3mS0YIk7g";
/** Sealed with a synthetic IV, as an agent's stable Pay link is. */
const stablePayStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.9wFM5EJy-pPMjP1p.KmemWS2NryGMx7iBK1TsjDwAjSLisxmCoT4FqLWdfFMhkCQjhsMobWmXK-ofRy9eqWMFKHhMSpqQ_pWs678_bfh0fljvNu-_pJskVAWLDNJ3YGe0vBM2BmADprSFBl3u0TxTZEAV2LF5785C2_458e6dVY8xeOR4NZuT7R6YzjtItCmvqMzgYQ8TK24I99otdZ0ItoJ9Nti6nlNuEyQGQ5tr-BM0gI6F8dtv5ylETsNmlwqvSqGCp6dOaMC4b0f713w4tvpN1OX46kSWuagrn1F84JO95Z3KUTCvnlLXRWBi7HduGAbBrjrnu29TXDvyx9lV2rWgIf8oD7aqn3BSsKzfcIF8woS_A3sNVPJPY2x-OnsnP28zKwHTHemcJj9wdPrqCHu3N7f4Zy2iqN6RaEIr1VuY26muhg7edXuEEcpS3MJF2XROJOFx5MniYJi-Q7ebwdHV7YKABYn5SWxSWBuQo_Ea8ZdGv0k2i9J4U5np4o57LB0STC8ZlGSZ9iO6YPv_NuAwPJUEXJcXG006K7tWWYe_6n0Su1bY5nnYJlxd5ihO0I8T33g4-do8PkO8w1_LlPoDVlUg42FVsPS_1acCMuzrHM-ycaM_tsHhMSVqSehS0eseILpDeDQEV5DPSPRvVkm59f9I32MrcAB61-cENWq23HMwwZ1gtS4j1CfbnUquJfmuheg6wt7REdGz-ZhijRr-I6jpwwhx5YJe7vVL-uInsexojmo96ALy93F7C1Q1ncSkxBWmvNCVmqZFTC9VinjpD4QFHM16HL71fsa81vt2ws7pMgTN26ihcLaX9FaQRryHRSlQnI8dfQnhhPA_jfjpRd8FjkN5OZlHSBH6lJQog1TONn8EbRHWYeQPT0begdIrxoUEbubeVeC3Nb1t7H1rbO1MKlhS3yk_c-MYugpp-FSwHcDx4eMR6TdK_8oyc4EoOPHF-hkHr-nF73Kr5JA3_EGBoffihG67PVLXkT2MA3CobX_i6e55wJ-x8ta2-grAQxRcR26gtJcmOfsSl_OZUUOJtrwV3KJRxLwsEyWfsPwOeQiVQVcB2b7F8gZgYLEYpWEoTSf4UhgMZy3kXaH4RMTIj9gqHXGGHqjJPKvBa1K8eM2qTNjv.as0UaQZnNQRm1ziVHUzGLQ";
/** Sealed with a random IV (all bytes 7). */
const advertisedPriceStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.BwcHBwcHBwcHBwcH.Ipnm9gxTxTsQhTvp86xRyh9RZz6iNsNypr4ioMtGsylvnaFNJD3bDNy1tGbk54CC89umLvi98zi8FgTBqR3WW8L1mJTfdZi7qrOF3wY10lgrqYEFPt68gUbhSBFr9-qOPQDtFnmREnBdyazqkOQdjf_hAcuVo_JrYKSTJfuxDcQ-odNE8TmChqsgsBru9hutXoY-zHyl6wm2XZ3yBXsk1nj-NrkRfm1B7VL3M9j9iy-pNjU8F5S7S5BJ9lljd9I7CcinQuWfEZr5wMWELCZszuXJvCQFcgN2T3fkTnWqC8PmxUzM32ENVe9eC4xTsEeb1_j8GxowgEnmLZo5p6Wfl2uCMkOKM7DBO3F_6ZH8Ols7vYbG7DGUfgsYWHGjn4S1tVnEi4EKijfawopzH_j8pc_NwQjurRncT9Q0ufA7CKSbAVUaROr94HyYeuj8ze5oZJj0uiEdtsh-cNFrxkLju3IkXd1YHsPm_isdvqypoNKoKpUQ-AcaIvAlLVuRzo4wvCnYaqvIrQdcrMiDFMB0ihN2MImzv6UjrQgTQTw5Si0FCLfbA8W2lifRIqyhrX6nm3cn3VdAoawqShUJqlgW6008wx0c1mTFRp9pSQeowrdlrGcFGbpElp4Ngm8McxhJ2KsCjeqkoFwYVVE3GcPAbRgpoubJaSaVVz73TUgbFLTouDmzxmfXjQOa9GPFdGBUv7NrSobd3IqpnYuHHDPFjo1diYgKm5kzOPJv9ig.jjqPmgfUDa6TJKsbsEvYvg";
/** Sealed with a synthetic IV. */
const stableAdvertisedPriceStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.ZALT_Mk40jHv3j4T.nczJV0qNv0nsWmxXecEAucUV40iRXjP02Ne4qb6UtaprJRhicQlJubz_W33f8r3D1wnNctf7lmuuQGpyk2gdg7cmA6CKO7VzN-QJVoDHn3MAc8jLGgMZGrVSzjfrnkBBzvVKNSEovt6fTZ1L1ENqSeNlR5mXEoctDLK0BeRQDZTQ-NjR9IHlj_4ImlkEtlJvnoxUCxX5C_vLOvDBO4XEmEkfIF1FqY7j-zMYR1xjmn5byyRSNZHHRMh6O-fIW59HE_lrsAbjFihPB7F1gWf8Nj1Ow1zkcOx-TVRfrzHDOgRriLYPc6Los3CzuZwXrlpsrbY7EjEqDB9Mcun915KJUMaC3ymouqNQtemnvc-GrYUcSdU7RdHRV5R4NB1UoaLrnrAHnbRFQbbKCApwHdIvEHUzeh6x5SNrjdnKnHxmb4kWiEegWzrgm9uHArfGMW_byTHPG4WewYfBqHxtUT__vpwu1gLzisNC-vTdjd78a-5tfQu4wFjllL-JOS17AHlH0lbCjgyaVF75k-5OYREEiui6Jir7Wwpbnh4JMFV_dOzO1OoryTo3QefMlkEDKNu6Be6s7tLNnBFh1mxj2wHtzgAiLwbVLLKsBMvVeJ1ULFHlUN5k7Xk74zsgw2SlobN_lGySrD2AlIHCELaSY9ZrsxD5LbrrAHQALOLAvzDrtvPPoUBQ438UkP1l-Lan15aOMkW4tk1yy3vAodux4CZrqG4jvnuGPkfBDAxo2BU.ws_KPNr0BusCXJMYSD6gxw";

/*
 * Issued by the code before PayState (origin/main 0648ff849) from the
 * golden order with every optional signed code, at `issuedAt` under
 * `goldenKey`: once with a random IV and once as a stable link.
 */
const encodedCarryingPayState = {
  kid: "golden",
  iat: 1780308000,
  exp: 1780308600,
  locale: "en-US",
  orderId: "golden-order-id",
  bookedAt: "2026-06-01T09:58:00.000Z",
  checkoutSessionId: "golden-checkout-session-id",
  acceptedTotal: {
    value: 55000,
    exponent: 2,
    currency: "CZK",
  },
  submittedCode: "GOLDEN10",
  submittedCodeDiscountId: "golden-discount-id",
  requestedDiscountCode: "GOLDEN10",
  referralCode: "FRIEND42",
  changedKeys: {
    sectionKeys: ["payment"],
    itemKeys: ["coffee"],
  },
  reservation: {
    kind: "cowork",
    name: "Golden Fixture",
    email: "golden@deskohub.test",
    phone: "+420 777 000 000",
    billing: {
      purpose: "personal",
      invoice: "none",
    },
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2026-06-20",
  },
  quote: {
    items: [
      {
        type: "cowork",
        tier: "profi",
        amount: {
          value: 55000,
          exponent: 2,
          currency: "CZK",
        },
      },
      {
        type: "coffee",
        amount: {
          value: 0,
          exponent: 2,
          currency: "CZK",
        },
      },
    ],
    fingerprint: "9be3045c",
    payment: {
      expectedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      undiscountedPrice: {
        value: 55000,
        exponent: 2,
        currency: "CZK",
      },
      discounts: [],
    },
  },
};

const carryingPayStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.bZNZm2JJs1rM-9JE.lLQbbH0A0d_AegeSsy5weUgo86bywW_2B1cX5oOxQpn_3LvsmkPDgzn_8L7Y5N9cIdo4Uj9YIr17Ty1Lomu3TZRC0YPTRtMEeQackZgBmC7R6pNpZvEDQ9yhLdFHHCQ6uooIdTIA4HiSxIr6EFaiBp3P9wd4JOhAcPjyFbtrQXThDebtn3lNHuX4fhgnBOxt7to96Otsp4hAzv4eX5W0pXP8bz1aktg5hau1Rw4ezyYR1jdLqTBThhmm6MEzVBr-32OFSvtoHD3zKjmAVG26q847aGVEXMo7U4yOgZA9sYZU4EnOaV4c6YIboC40qB6BRmUFyO3yAZonw0fkMeNU5iW44qEQcJwOkuBYaRJBG0jJ_1I_ML8KK3DRjDa4wjp0ONsQHRASeuIvUhQ8xxrbfTSS8UKY28RSnb8xgG0gkcgaVpm69NDqbQKgLEV3ggW6WCjjQZvyUz9GCph6jj_laaqMf6ZzmPci5uD1cQ3nm2Wp5cVBplzbktakBPwrTXL6oD0KzayZhpyHffrSDJWTIkGGcH78Ehenh8tCcLPU5ipt2LPKjfx_uapoxS0NAdvCq7k63YKB7LS0gonlAI2wA-Db9t_k-rEANLz7ArLSVV5yVDbLu1mpxGpeAbVfV6Fjf_1rilYbpabo_GypvwxImIBakJM6hbW88EM9B1KRqfbt34rQaoqYIqqE4_rkOTfOihNtG33uZwm00Cs9TPBlqiYqAKXWhEzvDN_A2BOaMQmApE6XdYcPrzvQVnMgxDxGNebmLCN4CIUABuxqVQLCHGliHS_Cd_GEeFV0JWJF2z4HwPsF4DuwFmuMi0myk9TgBXJSeZJ4ywjdNxQ-7KO2Ogh7shXgIn0zIPe1z-mYNO7MryZiyrnlykLANOcfWFiBjzD_bmasLC4GrVaDC5YbPOo3GFJHvxGbIngTPo1OFpyuBe2NO6EOQj2FhRwxdP57dHRATjey04BScwxlL89vnPgzbWCOA-O6l6MJ7ro6YR7SWC-VZGeJWkHC4pk30oby93-1TKXaHjQ7ii7OaADKeOV1aKG_m9N5NibxD_XIToMgKvgY7HpkzYdvHZe_zi4MQ5xlaSiFWtFSVOuqpO0SiZ2rNpDfAhoaMYe2HtEJ4PjjEbsaCHlNY9uIB8UwU9U5FvS96AHiIArqIp8b9DIaCS1VBMLAwGMHcTLCAXAxor5zHGPO33gvM3JOc0tkbAyDdvetqraRYo9T5Jd0FtEnlE6d4qIsmunwvXn8oODrD2Op4i_4NGPrJDepon0ux4mk1WieYYOGM2tB4_GSkuktFhvkTsDO1AbsNFFxVgPASX7mgYAoAgW9pM6_n7sp8jVuTKub4WCl__VMU7Jq-SnqADx3ZsPcJGryfHMaN31syo5cwc5Ybg.CtAm7W52RUHV5yHVsEJNyQ";
const stableCarryingPayStateToken =
  "eyJraWQiOiJnb2xkZW4ifQ.gEiEmpklVJZQoqkU._GxdZR94LyoWpnTNKLbmN_7JDi-rjYWSFAs4XZEo5glKfTRmc3H7bIda7oHPoqZfBgFZWj_6N9Av2ShttexmfSwGR9-vOydSHTQ-IPZyUsKoQS04pHHZXKZwdNAmK9yjDKltOvncaL6-mfd0aYH7J7gJF9hz1rqL_cuKm8zo_M6V3vR5Ld8V9Bkh3H7wsMsPipoZpHXRigtkJTCfnATa-_QsTbhvEqdblMg4AdwdczejPBe9tBZ46KcMn4C3e-Hdilkw8b9sJelsqWcQBj-V9gorMnM4FoBWAlcL2bngPS_hvcH1B3IhVZWSKEHD2dKq92jq9Knu0sPA17owLiY8UcHA-_unwHxbORr6def64WigrRGWgYW8OoXb7Gwcyd3BGaa8AOzgfiemSZd9d7A3Odpn0iL9X6DysdV06aYHRJW8zfrzMTbMl_p7hrWgCvs-_rKpY21ZdJgpVGVzDm_ldS4GgN_hBX12gDN4tAGLeEkZx1S2c67YiT1hqrXLIqGY9CIlJlxnJyIWYwqyOyeVmEU6DAmLGBUMD-RhMvY9F7zG8ZkBqh4doSwp2a25dc8Rt997pu3Pp_QyYCzXE4gwaloRZ2nZ4DoQyn-uINPP7LakNQbGMy8-Hhe7v8MvCPLa-FF2iWsKbYOUxtKc6WrBdbSSw0HUk9NA1BykJf13vnIAP4P5YaHP8p-ncMAPNee2HL5a-yRYz9nqSYb9w2E3ZbSyOvSEyW-6AYWoXx564mENiyQcEYD4HmUBUu1NBXRgQaMkKwCf2CTSMG7bX37hekbmaWuqnrDAm5Gj_-yfFxlkHI63Ciwiw41O0iql9vG9Y46CPbwiAVTlEdC6r9lyzZf1w6cwFFIxRIL0zNueW-EIiwdv5RpsoYA7p32lYZwjZI2ak4cwjzRU1mvw26_e1W8-0ZEc3NnmAaNZcYvYUtxMs4ElSUJa-qlz4lnVjAoSe9FjWuJveuLZwcFkUq26L7DdnIeUzKNMtUb6R8ZcAVS8fcWhQ0Hxs_doccRVmro40DQommjScuzso-Pq9keO97j6yxY69S4_RuFNTe1OHWq9YfSXswkdk7Gq5ppjmZVfHlABC-zu8UtkF4tcjkP8jC0TJSlZGXF12eS0NFSrY9HE9VFdTbpCM9lOwJyHo9zfu8_pBSDTpTZDxSA2XkaJ_oxSNJYlw6rXyy7L9GqRnG4UypB5CU_VAPGz3wJ4BJMikodQUE-D-2v54FTBO2JmCQXK_widXHzawxl6F5AdJnUldtfR40VJSwcREwwfejlDui1AL6ObK-wsFK0utClyTi20aowkvaCWn7HL7ahHpvwxY_QA1-M0od0iGBjxo6O-Q74sBzmhwfoSPK0Z-DdWaVs4OzDbzOUsYDZ6W956oBTwyFxuDw.yGLrxOyrAilXf7XDken9Eg";
const stableCarryingPayUrl =
  "/en-US/checkout/pay?payState=eyJraWQiOiJnb2xkZW4ifQ.gEiEmpklVJZQoqkU._GxdZR94LyoWpnTNKLbmN_7JDi-rjYWSFAs4XZEo5glKfTRmc3H7bIda7oHPoqZfBgFZWj_6N9Av2ShttexmfSwGR9-vOydSHTQ-IPZyUsKoQS04pHHZXKZwdNAmK9yjDKltOvncaL6-mfd0aYH7J7gJF9hz1rqL_cuKm8zo_M6V3vR5Ld8V9Bkh3H7wsMsPipoZpHXRigtkJTCfnATa-_QsTbhvEqdblMg4AdwdczejPBe9tBZ46KcMn4C3e-Hdilkw8b9sJelsqWcQBj-V9gorMnM4FoBWAlcL2bngPS_hvcH1B3IhVZWSKEHD2dKq92jq9Knu0sPA17owLiY8UcHA-_unwHxbORr6def64WigrRGWgYW8OoXb7Gwcyd3BGaa8AOzgfiemSZd9d7A3Odpn0iL9X6DysdV06aYHRJW8zfrzMTbMl_p7hrWgCvs-_rKpY21ZdJgpVGVzDm_ldS4GgN_hBX12gDN4tAGLeEkZx1S2c67YiT1hqrXLIqGY9CIlJlxnJyIWYwqyOyeVmEU6DAmLGBUMD-RhMvY9F7zG8ZkBqh4doSwp2a25dc8Rt997pu3Pp_QyYCzXE4gwaloRZ2nZ4DoQyn-uINPP7LakNQbGMy8-Hhe7v8MvCPLa-FF2iWsKbYOUxtKc6WrBdbSSw0HUk9NA1BykJf13vnIAP4P5YaHP8p-ncMAPNee2HL5a-yRYz9nqSYb9w2E3ZbSyOvSEyW-6AYWoXx564mENiyQcEYD4HmUBUu1NBXRgQaMkKwCf2CTSMG7bX37hekbmaWuqnrDAm5Gj_-yfFxlkHI63Ciwiw41O0iql9vG9Y46CPbwiAVTlEdC6r9lyzZf1w6cwFFIxRIL0zNueW-EIiwdv5RpsoYA7p32lYZwjZI2ak4cwjzRU1mvw26_e1W8-0ZEc3NnmAaNZcYvYUtxMs4ElSUJa-qlz4lnVjAoSe9FjWuJveuLZwcFkUq26L7DdnIeUzKNMtUb6R8ZcAVS8fcWhQ0Hxs_doccRVmro40DQommjScuzso-Pq9keO97j6yxY69S4_RuFNTe1OHWq9YfSXswkdk7Gq5ppjmZVfHlABC-zu8UtkF4tcjkP8jC0TJSlZGXF12eS0NFSrY9HE9VFdTbpCM9lOwJyHo9zfu8_pBSDTpTZDxSA2XkaJ_oxSNJYlw6rXyy7L9GqRnG4UypB5CU_VAPGz3wJ4BJMikodQUE-D-2v54FTBO2JmCQXK_widXHzawxl6F5AdJnUldtfR40VJSwcREwwfejlDui1AL6ObK-wsFK0utClyTi20aowkvaCWn7HL7ahHpvwxY_QA1-M0od0iGBjxo6O-Q74sBzmhwfoSPK0Z-DdWaVs4OzDbzOUsYDZ6W956oBTwyFxuDw.yGLrxOyrAilXf7XDken9Eg&orderId=golden-order-id";

const toJson = <A>(value: A): unknown => JSON.parse(JSON.stringify(value));

describe("Pay state token format", () => {
  test("issues an agent's stable Pay link to the pinned URL", () => {
    const pinned =
      Schema.decodeUnknownSync(signedPayStateSchema)(encodedPayState);
    const issued = run(
      PayState.issue(
        {
          locale: pinned.locale,
          reservation: pinned.reservation,
          quote: pinned.quote,
          orderId: pinned.orderId,
          bookedAt: pinned.bookedAt,
          checkoutSessionId: pinned.checkoutSessionId,
        } as Parameters<typeof PayState.issue>[0],
        { stableAt: Temporal.Instant.from(issuedAt.toISOString()) }
      )
    );
    const state = run(PayState.open(issued.payStateToken), {
      at: beforeExpiry(),
    });

    expect(toJson(state)).toEqual(toJson(pinned));
    expect(issued.payStateToken).toBe(stablePayStateToken);
    expect(issued.payUrl).toBe(
      `/en-US/checkout/pay?payState=${stablePayStateToken}&orderId=golden-order-id`
    );
  });

  test("issues a stable link carrying every signed code to the URL issued before PayState", () => {
    const pinned = Schema.decodeUnknownSync(signedPayStateSchema)(
      encodedCarryingPayState
    );
    const issued = run(
      PayState.issue(
        {
          locale: pinned.locale,
          reservation: pinned.reservation,
          quote: pinned.quote,
          orderId: pinned.orderId,
          bookedAt: pinned.bookedAt,
          checkoutSessionId: pinned.checkoutSessionId,
          submittedCode: pinned.submittedCode,
          submittedCodeDiscountId: pinned.submittedCodeDiscountId,
          requestedDiscountCode: pinned.requestedDiscountCode,
          referralCode: pinned.referralCode,
          changedKeys: pinned.changedKeys,
        } as Parameters<typeof PayState.issue>[0],
        { stableAt: Temporal.Instant.from(issuedAt.toISOString()) }
      )
    );

    expect(issued.payStateToken).toBe(stableCarryingPayStateToken);
    expect(issued.payUrl).toBe(stableCarryingPayUrl);
  });

  test("opens tokens carrying every signed code that were issued before PayState", () => {
    for (const token of [carryingPayStateToken, stableCarryingPayStateToken]) {
      const opened = run(PayState.open(token, { locale: "en-US" }), {
        at: beforeExpiry(),
      });
      expect(toJson(opened)).toEqual(encodedCarryingPayState);
    }
  });

  test("opens pinned tokens until they expire", () => {
    for (const token of [payStateToken, stablePayStateToken]) {
      const opened = run(PayState.open(token), { at: beforeExpiry() });
      expect(Schema.encodeUnknownSync(signedPayStateSchema)(opened)).toEqual(
        encodedPayState
      );

      const expired = run(Effect.result(PayState.open(token)), {
        at: afterExpiry(),
      });
      expect(Result.isFailure(expired) && expired.failure.code).toBe("expired");
    }
  });

  test("reads the reservation kind of an expired pinned token", () => {
    expect(
      run(PayState.restartKind(payStateToken), { at: afterExpiry() })
    ).toBe("cowork");
  });
});

describe("advertised price state token format", () => {
  test("opens pinned tokens and reseals them to the pinned bytes", () => {
    for (const token of [
      advertisedPriceStateToken,
      stableAdvertisedPriceStateToken,
    ]) {
      const opened = run(openAdvertisedPriceState(token), {
        at: beforeExpiry(),
      });
      expect(toJson(opened)).toEqual(encodedAdvertisedPriceState);
      expect(
        run(sealAdvertisedPriceState(opened, { deterministic: true }))
      ).toBe(stableAdvertisedPriceStateToken);
    }
  });

  test("rejects a pinned token once it expires", () => {
    const expired = run(
      Effect.result(openAdvertisedPriceState(advertisedPriceStateToken)),
      { at: afterExpiry() }
    );
    expect(Result.isFailure(expired) && expired.failure.code).toBe("expired");
  });
});
