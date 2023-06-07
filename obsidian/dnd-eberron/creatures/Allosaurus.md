---
statblock: inline
---
#monster

```statblock
name: Allosaurus
size: Large
type: beast
subtype: (dinosaur)
alignment: unaligned
ac: 13
hp: 51
hit_dice: 6d10+18
speed: 60 ft.
stats: [19, 13, 17, 2, 12, 5]
skillsaves:
  - perception: 5
senses: passive perception 15
languages: --
cr: 2
traits:
  - name: Pounce
  - desc: "If the allosaurus moves at least 30 feet straight toward a creature and then hits it with a claw attack on the same turn, that target must succeed on a DC 13 Strength saving throw or be knocked prone. If the target is prone, the allosaurus can make one bite attack against it as a bonus action."
actions:
  - name: Bite
    desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 15 (2d10 + 4) piercing damage."
  - name: Claw
    desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 4) slashing damage."
```