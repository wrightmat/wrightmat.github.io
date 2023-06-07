---
statblock: inline
---
#monster 

```statblock
name: Snowflake Ooze
size: Medium
type: Ooze
alignment: Unaligned
ac: 9
hp: 90
hit_dice: 12d8 + 36
speed: 20 ft.
stats: [15, 8, 16, 8, 11, 10]
skillsaves:
  - perception: 3
  - stealth: 3
damage_vulnerabilities: fire
damage_immunities: cold, poison
condition_immunities: blinded, charmed, deafened, exhaustion, poisoned, prone
senses: blindsight 60 ft. (blind beyond this radius), passive Perception 13
languages: --
cr: 2
traits:
  - name: Freezing Aura.
    desc: "At the start of each of the snowflake ooze’s turns, each creature within 5 feet of it takes 2 (1d4) cold damage."
  - name: Camouflage.
  - "The snowflake ooze has advantage on Dexterity (Stealth) checks made in ice or snow."
actions:
  - name: Constrict.
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 5 (1d6 + 2) bludgeoning damage plus 9 (2d8) cold damage, and the target is grappled (escape DC 14). Until this grapple ends, the creature is restrained, and the ooze can't constrict another target."
reactions:
  - name: Split.
    desc: "When a snowflake ooze that is Medium or larger is subjected to bludgeoning damage, it splits into two new oozes if it has at least 10 hit points. Each new ooze has hit points equal to half the original ooze's, rounded down. New oozes are one size smaller than the original ooze."
```

