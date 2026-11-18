// What the House's printed codes mean, in the House's own words. The code is
// stored as printed; the label beside it is what the page and the stats read.
// A code missing here fails check.mjs rather than loading unlabeled.

// "List of Asset Type Codes", https://fd.house.gov/reference/asset-type-codes.aspx,
// the list the 2020-on PTRs point to ("Asset Name" column, as printed). The
// page carries no date or version; transcribed 2026-11-18. PTRs before 2018
// print no code at all.
export const ASSET_TYPES = {
  '4K': '401K and Other Non-Federal Retirement Accounts',
  '5C': '529 College Savings Plan',
  '5F': '529 Portfolio',
  '5P': '529 Prepaid Tuition Plan',
  AB: 'Asset-Backed Securities',
  BA: 'Bank Accounts, Money Market Accounts and CDs',
  BK: 'Brokerage Accounts',
  CO: 'Collectibles',
  CS: 'Corporate Securities (Bonds and Notes)',
  CT: 'Cryptocurrency',
  DB: 'Defined Benefit Pension',
  DO: 'Debts Owed to the Filer',
  DS: 'Delaware Statutory Trust',
  EF: 'Exchange Traded Funds (ETF)',
  EQ: 'Excepted/Qualified Blind Trust',
  ET: 'Exchange Traded Notes',
  FA: 'Farms',
  FE: 'Foreign Exchange Position (Currency)',
  FN: 'Fixed Annuity',
  FU: 'Futures',
  GS: 'Government Securities and Agency Debt',
  HE: 'Hedge Funds & Private Equity Funds (EIF)',
  HN: 'Hedge Funds & Private Equity Funds (non-EIF)',
  IC: 'Investment Club',
  IH: 'IRA (Held in Cash)',
  IP: 'Intellectual Property & Royalties',
  IR: 'IRA',
  MA: 'Managed Accounts (e.g., SMA and UMA)',
  MF: 'Mutual Funds',
  MO: 'Mineral/Oil/Solar Energy Rights',
  OI: 'Ownership Interest (Holding Investments)',
  OL: 'Ownership Interest (Engaged in a Trade or Business)',
  OP: 'Options',
  OT: 'Other',
  PE: 'Pensions',
  PM: 'Precious Metals',
  PS: 'Stock (Not Publicly Traded)',
  RE: 'Real Estate Invest. Trust (REIT)',
  RF: 'REIT (EIF)',
  RN: 'REIT (non-EIF)',
  RP: 'Real Property',
  RS: 'Restricted Stock Units (RSUs)',
  SA: 'Stock Appreciation Right',
  ST: 'Stocks (including ADRs)',
  TR: 'Trust',
  VA: 'Variable Annuity',
  VI: 'Variable Insurance',
  WU: 'Whole/Universal Insurance',
};

// SP/DC/JT: the CY 2025 PTR form's instruction sheet ("by including an "SP"
// for spouse, "DC" for dependent child, or "JT" for jointly held property"),
// https://ethics.house.gov/wp-content/uploads/2026/02/Final-CY-2025-PTR-Form-1.pdf.
// The Instruction Guide (PDF p.21) says "dependent children". A blank owner
// is not defined anywhere ("You may, but are not required to, indicate"), so
// it has no label: it is not "Self".
export const OWNERS = {
  SP: 'Spouse',
  DC: 'Dependent child',
  JT: 'Jointly held property',
};

// The PTR's type column prints letters; the form names its check boxes
// Purchase, Sale, Partial Sale and Exchange, and the Instruction Guide defines
// the letters only for the annual report's Schedule A Block E (PDF p.58:
// "P" purchase, "S" sale, "E" exchange, "S (Partial)" a partial sale). The
// labels are the Senate's own words, so one type filter covers both chambers.
export const TYPES = {
  P: 'Purchase',
  S: 'Sale (Full)',
  'S (partial)': 'Sale (Partial)',
  E: 'Exchange',
};
