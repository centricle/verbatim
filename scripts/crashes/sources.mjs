// The six CSV files NHTSA publishes for Standing General Order 2021-01, plus
// the data element definitions. NHTSA splits reports by file, not by column:
// a row's system (ADS, Level 2 ADAS, or other) is known only from the file it
// came from, so each source carries it here.
//
// The archive files hold reports filed 2021 to mid-2025 under the original
// order and its second amendment, in a wider 137-column layout. The current
// files hold reports filed under the third amendment, in 116 columns. A report
// filed under both can appear in both, with a higher version in the current
// file, and can even move between system files (ADAS to OTHER).

export const BASE = 'https://static.nhtsa.gov/odi/ffdd/sgo-2021-01';

export const SOURCES = [
  { file: 'current-ads.csv', generation: 'current', system: 'ADS', url: `${BASE}/SGO-2021-01_Incident_Reports_ADS.csv` },
  { file: 'current-adas.csv', generation: 'current', system: 'ADAS', url: `${BASE}/SGO-2021-01_Incident_Reports_ADAS.csv` },
  { file: 'current-other.csv', generation: 'current', system: 'OTHER', url: `${BASE}/SGO-2021-01_Incident_Reports_OTHER.csv` },
  { file: 'archive-ads.csv', generation: 'archive', system: 'ADS', url: `${BASE}/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADS.csv` },
  { file: 'archive-adas.csv', generation: 'archive', system: 'ADAS', url: `${BASE}/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADAS.csv` },
  { file: 'archive-other.csv', generation: 'archive', system: 'OTHER', url: `${BASE}/Archive-2021-2025/SGO-2021-01_Incident_Reports_OTHER.csv` },
];

export const DICTIONARY = { file: 'data-element-definitions.pdf', url: `${BASE}/SGO-2021-01_Data_Element_Definitions.pdf` };
