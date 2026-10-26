import { describe, expect, it } from 'vitest';

import { characterEquipmentSchema } from './character-equipment.schema.js';

describe('characterEquipmentSchema', () => {
  it('keeps only what the page renders of each item, embellishments included', () => {
    const transmog = {
      item: { id: 194748, name: 'Split-Lens Specs' },
      display_string: 'Transmogrified to:\nSplit-Lens Specs',
    };
    const parsed = characterEquipmentSchema.parse({
      equipped_items: [
        {
          item: { key: { href: 'https://us.api.blizzard.com/data/wow/item/271465' }, id: 271465 },
          slot: { type: 'HEAD', name: 'Head' },
          name: 'Warhelm of the Consecrated Flame',
          media: { id: 271465 },
          bonus_list: [13452, 13658],
          enchantments: [{ enchantment_id: 7991, display_string: 'Enchanted: …' }],
          sockets: [{ socket_type: { type: 'PRISMATIC', name: 'Prismatic Socket' } }],
          set: { item_set: { id: 2062, name: 'Radiance of the Consecrated Flame' } },
          transmog,
          quantity: 1,
          quality: { type: 'EPIC', name: 'Epic' },
          stats: [{ type: { type: 'STAMINA' }, value: 1000 }],
          armor: { value: 275 },
          sell_price: { value: 434957 },
          requirements: { level: { value: 90 } },
          durability: { value: 93 },
          level: { value: 308, display_string: 'Item Level 308' },
          limit_category: 'Unique-Equipped: Embellished (2)',
          spells: [{ spell: { id: 1283697, name: 'Arcanoweave Lining' }, description: 'Equip: …' }],
          modified_crafting_stat: [{ id: 36 }],
        },
      ],
    });

    expect(Object.keys(parsed.equipped_items[0]!).sort()).toEqual([
      'bonus_list',
      'enchantments',
      'item',
      'level',
      'limit_category',
      'media',
      'name',
      'quality',
      'set',
      'slot',
      'sockets',
      'spells',
      'transmog',
    ]);
    expect(parsed.equipped_items[0]).toMatchObject({
      item: { id: 271465 },
      transmog,
      level: { value: 308 },
      quality: { type: 'EPIC' },
      limit_category: 'Unique-Equipped: Embellished (2)',
      spells: [{ spell: { id: 1283697, name: 'Arcanoweave Lining' } }],
    });
  });
});
