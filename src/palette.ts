/** Limited palette — oily industrial, with the two bots kept loudly distinct. */
export const P = {
  void: '#14101c',
  backdrop: '#1b1526',
  floor: '#2a2333',
  floorAlt: '#312938',
  grid: '#3a3145',
  wall: '#565068',
  wallLit: '#7d7596',
  wallDark: '#39344a',

  playerBody: '#3f7fd4',
  playerDark: '#2a5590',
  playerLight: '#79b0f2',
  enemyBody: '#d0524a',
  enemyDark: '#8f3630',
  enemyLight: '#f2897f',

  steel: '#a8a8bd',
  steelDark: '#6a6a82',
  steelLight: '#d6d6e6',
  // Wheels must read against the floor: losing one has to be visible instantly.
  rubber: '#453d52',
  rubberLit: '#9a92ad',
  rubberEdge: '#17131e',

  armor: '#8a8f6f',
  ballast: '#6d5f52',
  radar: '#5f7a86',
  armorDark: '#5c6049',
  armorHurt: '#a8703f',

  spark: '#ffd98a',
  hot: '#ff8a3d',
  danger: '#ff5548',
  good: '#7ad48a',

  ink: '#0d0a12',
  line: '#3a3145',
  pipOff: '#2a2333',
  text: '#e6e0f0',
  textDim: '#8c85a0',
  muted: '#7e7791',
} as const;
