// The `senator` values /trades/ links carried before the House joined the
// table (`?senator=Ron+L+Wyden`), each with the person it named and the
// name trade_members gives them now. Read once from production's
// senate_trades on 2026-11-18 (senator -> bioguide, 1:1 in all 53), which
// was frozen as the rollback and dropped on 2026-11-20, so the list is
// closed. trades check holds each
// bioguide and name to trade_members.
//
// [senator as linked, bioguide, member]
export const LEGACY_SENATORS = [
  ["A. Mitchell McConnell, Jr.", "M000355", "Mitch McConnell"],
  ["Angus S King, Jr.", "K000383", "Angus S. King, Jr."],
  ["Benjamin L Cardin", "C000141", "Benjamin L. Cardin"],
  ["Chris Van Hollen", "V000128", "Chris Van Hollen"],
  ["Christopher A Coons", "C001088", "Christopher A. Coons"],
  ["Cory A Booker", "B001288", "Cory A. Booker"],
  ["Daniel S Sullivan", "S001198", "Dan Sullivan"],
  ["David A Perdue , Jr", "P000612", "David Perdue"],
  ["Gary C Peters", "P000595", "Gary C. Peters"],
  ["Jacklyn S Rosen", "R000608", "Jacky Rosen"],
  ["James M Inhofe", "I000024", "James M. Inhofe"],
  ["Jeanne Shaheen", "S001181", "Jeanne Shaheen"],
  ["Jerry Moran,  ", "M000934", "Jerry Moran"],
  ["John A Barrasso", "B001261", "John Barrasso"],
  ["John Cornyn", "C001056", "John Cornyn"],
  ["John F Reed", "R000122", "Jack Reed"],
  ["John Hoeven", "H001061", "John Hoeven"],
  ["John N Kennedy", "K000393", "John Kennedy"],
  ["John W Hickenlooper", "H000273", "John W. Hickenlooper"],
  ["Joseph Manchin, III", "M001183", "Joe Manchin, III"],
  ["Kelly Loeffler", "L000594", "Kelly Loeffler"],
  ["Ladda Tammy Duckworth", "D000622", "Tammy Duckworth"],
  ["Lamar Alexander", "A000360", "Lamar Alexander"],
  ["Maria Cantwell", "C000127", "Maria Cantwell"],
  ["Mark R Warner", "W000805", "Mark R. Warner"],
  ["Michael  B Enzi", "E000285", "Michael B. Enzi"],
  ["Michael D Crapo", "C000880", "Mike Crapo"],
  ["Michael F Bennet", "B001267", "Michael F. Bennet"],
  ["Mike Rounds", "R000605", "Mike Rounds"],
  ["Pat Roberts", "R000307", "Pat Roberts"],
  ["Patrick J Toomey", "T000461", "Patrick J. Toomey"],
  ["Patty Murray", "M001111", "Patty Murray"],
  ["Rafael E Cruz", "C001098", "Ted Cruz"],
  ["Rick Scott", "S001217", "Rick Scott"],
  ["Robert J Portman", "P000449", "Rob Portman"],
  ["Robert P Casey, Jr.", "C001070", "Robert P. Casey, Jr."],
  ["Roger F Wicker", "W000437", "Roger F. Wicker"],
  ["Ron Johnson", "J000293", "Ron Johnson"],
  ["Ron L Wyden", "W000779", "Ron Wyden"],
  ["Ron Wyden", "W000779", "Ron Wyden"],
  ["Roy Blunt", "B000575", "Roy Blunt"],
  ["Sheldon Whitehouse", "W000802", "Sheldon Whitehouse"],
  ["Shelley M Capito", "C001047", "Shelley Moore Capito"],
  ["Steve Daines", "D000618", "Steve Daines"],
  ["Susan M Collins", "C001035", "Susan M. Collins"],
  ["Tammy Duckworth", "D000622", "Tammy Duckworth"],
  ["Thomas R Carper", "C000174", "Thomas R. Carper"],
  ["Thomas R Tillis", "T000476", "Thom Tillis"],
  ["Thomas Udall", "U000039", "Tom Udall"],
  ["Timothy M Kaine", "K000384", "Tim Kaine"],
  ["Tina Smith", "S001203", "Tina Smith"],
  ["William Cassidy", "C001075", "Bill Cassidy"],
  ["William F Hagerty, IV", "H000601", "Bill Hagerty"],
];

const key = (s) => String(s).replace(/\s+/g, ' ').trim();
const BY_SENATOR = new Map(LEGACY_SENATORS.map(([senator, bioguide, member]) => [key(senator), { bioguide, member }]));

// The member an old `senator` value names, or undefined.
export const legacySenator = (senator) => (senator == null ? undefined : BY_SENATOR.get(key(senator)));
