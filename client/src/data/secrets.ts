// The three secret fighters of the select screen: special versions (skins) of existing fighters,
// unlocked by winning a fight with the right fighter against the right rival.
export interface Secret {
  id: string;
  char: string; // fighter id
  skin: number; // skin index in the fighter's skins list
  name: string; // Hebrew card name
  title: string;
  glow: string;
  winWith: string; // fighter id you must win with
  against: string; // fighter id you must beat
}

export const SECRETS: Secret[] = [
  { id: 'gold-odedsvr', char: 'odedsvr', skin: 1, name: 'עודד הזהוב', title: 'GOLDEN HOST', glow: '#e8b646', winWith: 'odedsvr', against: 'ronengg' },
  { id: 'neon-inde', char: 'inde', skin: 1, name: 'אינדה ניאון', title: 'NEON LEGEND', glow: '#a347ff', winWith: 'inde', against: 'nave' },
  { id: 'gold-ronengg', char: 'ronengg', skin: 1, name: 'רונן האלוף', title: 'GOLDEN CHAMP', glow: '#53fc18', winWith: 'ronengg', against: 'odedsvr' },
];
