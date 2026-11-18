// The key naming one member of a series, as scripts/corpus/build_release.py's
// member_key writes it into each record's series_member: the list's ordinal
// when it numbers its members, else the member's date, else its year, plus
// the speaker. scripts/corpus/series-member.test.mjs holds the two to the
// same answer for every member of series.json.
export function memberKey(series, member) {
  if (member.ordinal != null) return `${series}:${member.ordinal}`;
  return `${series}:${member.date || member.year}:${member.speaker}`;
}
