/**
 * Server-only word list. This file is never imported by the browser bundle.
 * Words are lower-case singular/common nouns with at least five letters.
 */
export const WORDS = [
  'acorn', 'album', 'anchor', 'anvil', 'apron', 'arch', 'arrow', 'asteroid', 'atlas', 'aurora',
  'badge', 'bamboo', 'banjo', 'barrel', 'beacon', 'beetle', 'bicycle', 'biscuit', 'blossom', 'bolt',
  'boomerang', 'bottle', 'bramble', 'breeze', 'bridge', 'bubble', 'bucket', 'buffalo', 'cactus', 'camera',
  'candle', 'canoe', 'canyon', 'carrot', 'castle', 'cauldron', 'celery', 'chalk', 'chandelier', 'cheese',
  'cherry', 'chimney', 'cinnamon', 'circuit', 'clover', 'cactus', 'comet', 'compass', 'cookie', 'coral',
  'cosmos', 'cotton', 'crayon', 'cricket', 'crown', 'crystal', 'cyclone', 'dagger', 'daisy', 'desert',
  'diamond', 'dolphin', 'domino', 'donut', 'dragon', 'drum', 'eagle', 'earth', 'easel', 'eclipse',
  'ember', 'engine', 'envelope', 'falcon', 'feather', 'fiddle', 'firefly', 'flamingo', 'flute', 'forest',
  'fossil', 'fountain', 'galaxy', 'garden', 'gazebo', 'gecko', 'ginger', 'glacier', 'globe', 'gnome',
  'goblet', 'goggles', 'gondola', 'gravity', 'guitar', 'hammock', 'harbor', 'hazel', 'helmet', 'hermit',
  'honey', 'hornet', 'hourglass', 'iceberg', 'igloo', 'island', 'jacket', 'jaguar', 'jelly', 'jigsaw',
  'journey', 'jungle', 'kayak', 'kettle', 'keyhole', 'kitten', 'koala', 'ladder', 'lantern', 'lava',
  'leaf', 'lemon', 'leopard', 'lighthouse', 'lilac', 'lizard', 'lobster', 'locket', 'lotus', 'magnet',
  'mango', 'maple', 'marble', 'mask', 'meadow', 'medal', 'meteor', 'mermaid', 'mirror', 'mitten',
  'monkey', 'moon', 'mosaic', 'moth', 'mountain', 'mushroom', 'nebula', 'needle', 'nest', 'ninja',
  'notebook', 'nutmeg', 'oasis', 'ocean', 'octopus', 'olive', 'onion', 'orbit', 'orchid', 'otter',
  'owl', 'paint', 'palace', 'panda', 'paper', 'parrot', 'peach', 'peacock', 'pebble', 'penguin',
  'pepper', 'piano', 'picnic', 'pillow', 'pineapple', 'planet', 'plank', 'plum', 'pocket', 'poem',
  'polaris', 'pond', 'poppy', 'portal', 'potato', 'prism', 'pumpkin', 'puppet', 'puzzle', 'pyramid',
  'quail', 'quartz', 'quilt', 'rabbit', 'raccoon', 'radar', 'rainbow', 'raven', 'reef', 'ribbon',
  'river', 'robot', 'rocket', 'rose', 'rover', 'rudder', 'saddle', 'sailboat', 'saturn', 'scarves',
  'scooter', 'scroll', 'seahorse', 'seashell', 'ship', 'shovel', 'sitar', 'sketch', 'skull', 'sloth',
  'snowflake', 'socket', 'spider', 'spiral', 'spoon', 'sprout', 'squid', 'star', 'statue', 'stone',
  'storm', 'sunflower', 'surfboard', 'swan', 'sweater', 'taco', 'tambourine', 'telescope', 'teapot', 'tent',
  'thimble', 'thunder', 'tiger', 'tiara', 'toaster', 'tomato', 'topaz', 'torch', 'tornado', 'tortoise',
  'totem', 'tower', 'train', 'treasure', 'tree', 'tricycle', 'trumpet', 'tulip', 'turtle', 'umbrella',
  'unicorn', 'valley', 'vase', 'velvet', 'violin', 'volcano', 'waffle', 'wagon', 'walnut', 'walrus',
  'waterfall', 'weasel', 'whale', 'wheel', 'willow', 'window', 'wizard', 'wombat', 'xylophone', 'yarn',
  'yacht', 'yeti', 'yogurt', 'zebra', 'zeppelin', 'zinnia',
] as const;

export function pickWord(exclude: readonly string[] = []): string {
  const excluded = new Set(exclude);
  const candidates = WORDS.filter((word) => !excluded.has(word));
  const pool = candidates.length > 0 ? candidates : WORDS;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? 'comet';
}
