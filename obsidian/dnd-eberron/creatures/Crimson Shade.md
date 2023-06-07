---
statblock: inline
---
#monster 

```statblock
name: Crimson Shade
size: Medium
type: Fey
alignment: Chaotic Evil
ac: 12
hp: 27
hit_dice: 6d8
speed: 40 ft.
stats: [6, 14, 10, 9, 10, 12]
skillsaves:
  - stealth: 6
damage_vulnerabilities: Radiant
damage_resistances: Acid, Cold, Fire, Lightning, Thunder; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks
damage_immunities: Necrotic, Poison
condition_immunities: Exhaustion, Frightened, Grappled, Paralyzed, Petrified, Poisoned, Prone, Restrained
senses: Darkvision 60 ft., Passive Perception 10
languages: Common, understands but can't speak
cr: 0.5
traits:
  - name: Amorphous.
    desc: "The crimson shade can move through a space as narrow as 1 inch wide without squeezing."
  - name: Shadow Stealth.
    desc: "While in dim light or darkness, the crimson shade can take the Hide action as a bonus action."
  - name: Sunlight Sensitivity.
    desc: "While in sunlight, the crimson shade has disadvantage on attack rolls, as well as on Wisdom (Perception) checks that rely on sight."
  - name: Shielded Mind.
    desc: "The crimson shade is immune to scrying and to any effect that would sense its emotions, read its thoughts, or detect its location."
actions:
  - name: Shadow Touch.
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (2d4 + 0) cold damage."
  - name: Necrotic Breath (Recharge 5-6).
    desc: "The crimson shade exhales shadowy energy in a 15-foot cone. Each creature in that area must make a DC 12 Dexterity saving throw, taking 18 (4d8) necrotic damage on a failed save, or half as much damage on a successful one. A humanoid slain by this attack rises 24 hours later as a crimson shade, unless the humanoid is restored to life or its body is destroyed."
reactions:
  - name: Cursed Body.
    desc: A creature that hits the crimson shade with a melee attack while within 5 feet of it must succeed on a DC 13 Wisdom saving throw or be frightened of the shade for 1 minute. A creature can repeat this saving throw at the start of each of its turns, ending the effect on a success.
```