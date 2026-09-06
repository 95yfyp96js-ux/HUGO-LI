import type { Deity, FortuneSet, Ritual, Temple } from '@/domain/types';

/**
 * Mock 內容資料。全部標示 contentSource: 'MOCK_DATA'——
 * 這些不是任何真實寺廟授權的宗教內容，僅供原型展示。見 SECURITY.md Phase 10。
 */

export const MOCK_TEMPLES: Temple[] = [
  {
    id: 'temple-qingshan',
    name: '青山宮（示意）',
    city: '台北市',
    address: '示意地址・萬華區某路一段 1 號',
    deityIds: ['deity-mazu', 'deity-guanyin'],
    description: '本資料為示意內容，非真實寺廟授權資訊，僅供原型展示信仰探索體驗。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'temple-wenchang',
    name: '文昌閣（示意）',
    city: '台中市',
    address: '示意地址・北區某路二段 88 號',
    deityIds: ['deity-wenchang', 'deity-guangong'],
    description: '本資料為示意內容，非真實寺廟授權資訊，僅供原型展示信仰探索體驗。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'temple-yuelao',
    name: '月老祠（示意）',
    city: '台南市',
    address: '示意地址・中西區某路三段 12 號',
    deityIds: ['deity-yuelao', 'deity-mazu'],
    description: '本資料為示意內容，非真實寺廟授權資訊，僅供原型展示信仰探索體驗。',
    contentSource: 'MOCK_DATA',
  },
];

export const MOCK_DEITIES: Deity[] = [
  {
    id: 'deity-mazu',
    name: '媽祖',
    title: '天上聖母',
    domain: ['平安健康', '合境平安'],
    templeIds: ['temple-qingshan', 'temple-yuelao'],
    description:
      '民間信仰中掌管航海與地方平安的重要神祇之一。此描述為原型示意內容，非官方宗教文本。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'deity-guanyin',
    name: '觀音',
    title: '觀世音菩薩',
    domain: ['平安健康', '陰陽調和'],
    templeIds: ['temple-qingshan'],
    description: '民間信仰中象徵慈悲與救苦的重要信仰對象。此描述為原型示意內容，非官方宗教文本。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'deity-wenchang',
    name: '文昌帝君',
    title: '文昌帝君',
    domain: ['學業事業'],
    templeIds: ['temple-wenchang'],
    description: '民間信仰中掌管文運與科舉考試的神祇。此描述為原型示意內容，非官方宗教文本。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'deity-guangong',
    name: '關聖帝君',
    title: '關公',
    domain: ['財運', '學業事業'],
    templeIds: ['temple-wenchang'],
    description: '民間信仰中象徵忠義與招財的神祇。此描述為原型示意內容，非官方宗教文本。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'deity-yuelao',
    name: '月老',
    title: '月下老人',
    domain: ['姻緣感情'],
    templeIds: ['temple-yuelao'],
    description: '民間信仰中掌管姻緣的神祇。此描述為原型示意內容，非官方宗教文本。',
    contentSource: 'MOCK_DATA',
  },
];

const LEVELS = ['上上籤', '上籤', '中籤', '中平籤', '下籤', '下下籤'] as const;

const POEMS = [
  '雲開見月正分明，塵盡光生寶鏡清。若向此中尋覓得，何愁大道不能成。',
  '風恬浪靜可行舟，仔細思量在心頭。若得貴人相扶助，凡事亨通不用愁。',
  '花開花謝有時節，緣分深淺各自知。莫將此心懸兩處，靜待春來自分明。',
  '路遠山高水又深，中途未必是知音。若逢貴客相攜手，撥雲見日始安心。',
  '舊事重提費思量，新機未動且徐行。耐心守拙终有望，不必匆匆問吉凶。',
  '危舟過峽浪千層，穩把舵心自可行。莫道前途多險阻，守正待時終見晴。',
];

function buildFortuneSet(deityId: string): FortuneSet {
  const sticks = Array.from({ length: 24 }, (_, index) => {
    const levelIndex = index % LEVELS.length;
    const poemIndex = index % POEMS.length;
    return {
      id: `${deityId}-stick-${index + 1}`,
      number: index + 1,
      level: LEVELS[levelIndex],
      poem: POEMS[poemIndex],
      categories: MOCK_DEITIES.find((d) => d.id === deityId)?.domain ?? ['平安健康'],
    };
  });
  return { deityId, sticks };
}

export const MOCK_FORTUNE_SETS: Record<string, FortuneSet> = Object.fromEntries(
  MOCK_DEITIES.map((deity) => [deity.id, buildFortuneSet(deity.id)]),
);

export const MOCK_RITUALS: Ritual[] = [
  {
    id: 'ritual-shoujing',
    templeId: 'temple-qingshan',
    name: '收驚（示意預約入口）',
    description:
      '傳統上用於安撫受驚嚇後身心不安的儀式，實際儀式須由寺廟人員親自執行，本平台僅提供了解與預約入口。',
    applicabilityNotes: '若近期遭遇驚嚇、睡眠不安等情況，可考慮諮詢寺廟人員是否適合此儀式。',
    disclaimer:
      '本平台不執行、不模擬此儀式，亦不對儀式效果做任何保證。是否適合仍請以寺廟現場專業人員判斷為準。',
    contentSource: 'MOCK_DATA',
  },
  {
    id: 'ritual-buyun',
    templeId: 'temple-wenchang',
    name: '補運（示意預約入口）',
    description:
      '傳統上用於在低潮時期尋求心理安定與儀式性重新開始的作法，實際儀式須由寺廟人員親自執行。',
    applicabilityNotes: '若近期感覺諸事不順、情緒低落，可考慮諮詢寺廟人員是否適合此儀式。',
    disclaimer:
      '本平台不執行、不模擬此儀式，亦不對儀式效果做任何保證，不涉及醫療建議。是否適合仍請以寺廟現場專業人員判斷為準。',
    contentSource: 'MOCK_DATA',
  },
];
