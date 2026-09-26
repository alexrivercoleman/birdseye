// Sample trails for demos: real OSM trail shapes around Piedmont Park, the BeltLine and Freedom Park (simplified),
// with made-up species counts. Mock mode serves them as the whole map; the real map draws them on top of the API's
// trails until real walks fill it in (VITE_MAP_SAMPLES=false turns that off). trail_ids start with "sample-", so
// their species sheets are answered here instead of by the API.
import type { CommunityMap, Tier, TrailSpecies } from './types'

export const SAMPLE_TRAILS: CommunityMap['trails'] = [
  { trail_id: 'sample-1', name: 'Stone Mountain Trail', species_total: 18, geometry: { type: 'MultiLineString', coordinates: [[[-84.38192,33.76197],[-84.38188,33.762],[-84.38186,33.76201],[-84.38183,33.76203],[-84.38179,33.76205],[-84.38174,33.76207],[-84.38167,33.76208],[-84.38161,33.76208],[-84.38113,33.76209]],[[-84.38113,33.76209],[-84.38073,33.76205],[-84.38037,33.76194],[-84.38005,33.76177],[-84.37948,33.76144],[-84.37897,33.7613],[-84.37855,33.76129],[-84.37807,33.7613],[-84.3772,33.76131],[-84.37706,33.76129]],[[-84.36073,33.76376],[-84.36224,33.76308],[-84.36375,33.76255],[-84.36487,33.76189],[-84.36554,33.76163],[-84.36697,33.7611],[-84.36893,33.76026],[-84.37003,33.75992],[-84.37156,33.75992],[-84.37195,33.76003]],[[-84.35923,33.76439],[-84.35935,33.76435],[-84.35955,33.76428],[-84.35989,33.76415],[-84.36005,33.76408]],[[-84.34258,33.77116],[-84.3433,33.77107],[-84.34327,33.77076],[-84.34374,33.77091],[-84.34458,33.77056],[-84.34556,33.77018],[-84.34639,33.77049],[-84.34726,33.77078],[-84.34815,33.7705],[-84.34892,33.76985]],[[-84.3526,33.76891],[-84.35293,33.76855],[-84.35356,33.76824],[-84.35481,33.76669],[-84.35537,33.76602],[-84.3554,33.76523],[-84.35572,33.76481],[-84.35648,33.76429],[-84.3582,33.7644],[-84.35923,33.76439]],[[-84.34916,33.76982],[-84.34937,33.7698],[-84.34974,33.7698],[-84.35036,33.76973],[-84.35079,33.76964],[-84.35091,33.76956],[-84.35123,33.76928],[-84.35143,33.76917],[-84.35185,33.76907],[-84.35246,33.76894]],[[-84.35246,33.76894],[-84.35253,33.76893],[-84.3526,33.76891]],[[-84.34892,33.76985],[-84.34897,33.76985],[-84.34905,33.76984],[-84.3491,33.76983],[-84.34915,33.76982],[-84.34916,33.76982]],[[-84.36011,33.76406],[-84.36073,33.76376]],[[-84.36005,33.76408],[-84.36011,33.76406]]] } },
  { trail_id: 'sample-2', name: 'Atlanta Beltline Eastside Trail', species_total: 27, geometry: { type: 'MultiLineString', coordinates: [[[-84.36092,33.76758],[-84.36071,33.76737]],[[-84.36071,33.76737],[-84.35984,33.76616],[-84.35959,33.76497],[-84.35968,33.76392],[-84.35995,33.76316],[-84.36042,33.76243],[-84.36112,33.76172],[-84.36298,33.76039],[-84.36409,33.75934],[-84.36488,33.75761]],[[-84.36456,33.77322],[-84.36441,33.77263],[-84.36428,33.77214],[-84.36428,33.77213],[-84.36423,33.77199],[-84.36398,33.77142],[-84.36397,33.77137],[-84.36399,33.77131],[-84.36399,33.77126]],[[-84.36399,33.77126],[-84.36388,33.77101]],[[-84.36388,33.77101],[-84.36379,33.77093],[-84.36374,33.77086],[-84.36334,33.7702],[-84.36276,33.76944],[-84.36237,33.769],[-84.36215,33.76879],[-84.36184,33.76848],[-84.36131,33.76795],[-84.36092,33.76758]],[[-84.36398,33.77142],[-84.36389,33.77138]],[[-84.36373,33.77101],[-84.36371,33.77096],[-84.36373,33.77085]],[[-84.36379,33.77124],[-84.36374,33.77105],[-84.36373,33.77101]],[[-84.36389,33.77138],[-84.36386,33.77135],[-84.36384,33.77133]],[[-84.36384,33.77133],[-84.3638,33.77127],[-84.36379,33.77124]],[[-84.36852,33.78201],[-84.36836,33.7818],[-84.36773,33.78097],[-84.36745,33.78072],[-84.3669,33.78003],[-84.36626,33.77908],[-84.3657,33.77781],[-84.36537,33.77676],[-84.3647,33.77375],[-84.36463,33.77351]]] } },
  { trail_id: 'sample-3', name: 'Atlanta Beltline Northeast Trail', species_total: 9, geometry: { type: 'MultiLineString', coordinates: [[[-84.36864,33.78218],[-84.37058,33.78505],[-84.37092,33.78696],[-84.3707,33.78884],[-84.37093,33.78935],[-84.37124,33.78948],[-84.37071,33.79103],[-84.37103,33.79182],[-84.37142,33.7927],[-84.37034,33.79376]],[[-84.37262,33.79826],[-84.37243,33.79791],[-84.37225,33.79748],[-84.37196,33.79704],[-84.37101,33.79556],[-84.3709,33.79539],[-84.37052,33.79462],[-84.37041,33.7943],[-84.37042,33.79408],[-84.37038,33.79387]]] } },
  { trail_id: 'sample-4', name: 'Active Oval', species_total: 14, geometry: { type: 'MultiLineString', coordinates: [[[-84.37554,33.78772],[-84.37656,33.78736],[-84.37703,33.78644],[-84.37701,33.78515],[-84.37654,33.78476],[-84.37556,33.78491],[-84.3753,33.78529],[-84.37503,33.78625],[-84.37489,33.78713],[-84.37554,33.78772]]] } },
  { trail_id: 'sample-5', name: 'Kendeda Canopy Walk', species_total: 6, geometry: { type: 'MultiLineString', coordinates: [[[-84.37305,33.79064],[-84.37306,33.79086],[-84.37297,33.79099],[-84.37282,33.79107],[-84.37263,33.79118],[-84.37256,33.7913],[-84.37256,33.79146],[-84.37265,33.79161],[-84.37287,33.79169],[-84.37313,33.79165]]] } },
  { trail_id: 'sample-6', name: 'Azalea Walk', species_total: 4, geometry: { type: 'MultiLineString', coordinates: [[[-84.37314,33.79142],[-84.37295,33.79151],[-84.37287,33.79151],[-84.37288,33.79144],[-84.37297,33.79133],[-84.37276,33.79112],[-84.37274,33.79123],[-84.37269,33.79137],[-84.37256,33.79159],[-84.37251,33.79186]]] } },
]

// heat: every trail vertex, weighted by the trail's species count
export const SAMPLE_HEAT: CommunityMap['heat'] = SAMPLE_TRAILS.flatMap((t) =>
  (t.geometry.type === 'MultiLineString' ? t.geometry.coordinates.flat() : t.geometry.coordinates).map(([lng, lat], i) => ({
    lat, lng, weight: 1 + ((i * 7 + t.species_total) % 6),
  })),
)

export const isSampleTrail = (trailId: string) => trailId.startsWith('sample-')

// Atlanta birds, most often heard first
const SPECIES: [string, string, Tier][] = [
  ['carwre', 'Carolina Wren', 'common'], ['norcar', 'Northern Cardinal', 'common'], ['blujay', 'Blue Jay', 'common'],
  ['amecro', 'American Crow', 'common'], ['carchi', 'Carolina Chickadee', 'common'], ['tuftit', 'Tufted Titmouse', 'common'],
  ['normoc', 'Northern Mockingbird', 'common'], ['rebwoo', 'Red-bellied Woodpecker', 'common'], ['amerob', 'American Robin', 'common'],
  ['dowwoo', 'Downy Woodpecker', 'common'], ['whbnut', 'White-breasted Nuthatch', 'uncommon'], ['brnthr', 'Brown Thrasher', 'uncommon'],
  ['pilwoo', 'Pileated Woodpecker', 'uncommon'], ['rethaw', 'Red-tailed Hawk', 'uncommon'], ['paibun', 'Painted Bunting', 'rare'],
]

export function sampleTrailSpecies(trailId: string): TrailSpecies {
  const t = SAMPLE_TRAILS.find((x) => x.trail_id === trailId)
  const n = Math.min(15, t?.species_total ?? 0)
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  return {
    name: t?.name ?? 'Trail',
    top_species: SPECIES.slice(0, n).map(([species_code, common_name, rarity_tier], i) => ({
      species_code, common_name, rarity_tier,
      walks: Math.max(1, 20 - i * 2 - (i > 10 ? 4 : 0)),
      users: Math.max(1, 10 - i),
      last_heard_at: hoursAgo(2 + i * 5),
    })),
  }
}

// The pre-§7.13 API stub returns this made-up 3-point trail; hide it while the deployed API still runs the stub.
const STUB_TRAIL_ID = '00000000-0000-0000-0000-00000000a001'

export function withSamples(d: CommunityMap): CommunityMap {
  const trails = d.trails.filter((t) => t.trail_id !== STUB_TRAIL_ID)
  return { ...d, trails: [...trails, ...SAMPLE_TRAILS], heat: [...d.heat, ...SAMPLE_HEAT] }
}
