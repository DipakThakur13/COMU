export interface Profile {
  name: string;
  /** Where the vendor drops files. */
  inbox: string;
  /** IANA-ish label used by the timestamp normaliser. Not a UTC offset by accident. */
  exchangeZone: string;
  /** Minutes the exchange runs ahead of UTC. Kept as a number so no library is needed. */
  exchangeOffsetMinutes: number;
  baseCurrency: string;
  /** Vendor column name to canonical field name. */
  columns: Record<string, string>;
}

const LSE: Profile = {
  name: "lse",
  inbox: "/feeds/lse",
  exchangeZone: "Europe/London",
  exchangeOffsetMinutes: 60,
  baseCurrency: "GBP",
  columns: {
    SYM: "symbol",
    PX: "price",
    CCY: "currency",
    QTY: "size",
    TS: "observedAt",
    VEN: "venue"
  }
};

const XETRA: Profile = {
  name: "xetra",
  inbox: "/feeds/xetra",
  exchangeZone: "Europe/Berlin",
  exchangeOffsetMinutes: 120,
  baseCurrency: "EUR",
  columns: {
    instrument: "symbol",
    last: "price",
    ccy: "currency",
    vol: "size",
    time: "observedAt",
    mic: "venue"
  }
};

const DEFAULT: Profile = { ...LSE, name: "default", exchangeOffsetMinutes: 0 };

export function profileByName(name: string): Profile {
  if (name === "lse") return LSE;
  if (name === "xetra") return XETRA;
  return DEFAULT;
}

export function allProfiles(): Profile[] {
  return [LSE, XETRA, DEFAULT];
}
