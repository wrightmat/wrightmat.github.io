---
statblock: inline
---
#monster 

```statblock
name: Cloud Giant Ghost
size: Huge
type: undead
alignment: unaligned
ac: 15
hp: 104
hit_dice: 16d12
speed: 0 ft., 40 ft. (hover)
stats: [27, 11, 10, 12, 16, 17]
skillsaves:
  - wisdom: 7
  - charisma: 7
skills:
  - perception: 7 
damage_resistances: Cold
damage_immunities: Necrotic, Poison
condition_immunities: Charmed, Exhaustion, Frightened, Grappled, Paralyzed, Petrified, Poisoned, Prone, Restrained
senses: darkvision 120 ft., passive perception 17
languages: Common, Giant
cr: 9
traits:
  - name: Ethereal Sight
    desc: "The ghost can see 120 feet into the Ethereal Plane when it is on the Material Plane, and vice versa."
  - name: Incorporeal Movement
    desc: "The ghost can move through other creatures and objects as if they were difficult terrain. It takes 5 (1d10) force damage if it ends its turn inside an object."
  - name: Regeneration
    desc: "The ghost regains 10 hit points at the start of its turn. If the ghost takes radiant damage or damage from a magic weapon, this trait doesn’t function at the start of the ghost’s next turn. The ghost dies only if it starts its turn with 0 hit points and doesn’t regenerate."
actions:
  - name: Multiattack
    desc: "The ghost makes two melee attacks."
  - name: Spectral Weapon
    desc: "Melee Weapon Attack: +12 to hit, reach 10 ft., one target. Hit: 21 (3d8 + 8) force damage."
  - name: Etherealness
    desc: "The ghost enters the Ethereal Plane from the Material Plane, or vice versa. It is visible on the Material Plane while it is in the Border Ethereal, and vice versa, yet it can’t affect or be affected by anything on the other plane."
  - name: Wind Howl (Recharge 6)
    desc: "The ghost emits a dreadful howl that summons a cold, biting wind. This wind engulfs up to three creatures of the ghost’s choice that it can see within 60 feet of it. Each target is pulled up to 20 feet toward the ghost and must make a DC 15 Constitution saving throw, taking 16 (3d10) cold damage on a failed save, or half as much damage on a successful one."
spells:
  - "The ghost casts one of the following spells, using Charisma as the spellcasting ability and requiring no material components:"
  - At will: fog cloud
  - 3/day: telekinesis
  - 1/day: control weather
```