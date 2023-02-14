---
statblock: inline
---
#monster 

```statblock
name: Tree Blight
size: Huge
type: plant
alignment: neutral evil
ac: 15
hp: 92
hit_dice: 8d12+40
speed: 30 ft.
stats: [23, 10, 20, 6, 10, 3]
senses: blindsight 60 ft., passive perception 10
condition_immunities: Blinded, Deafened
languages: understands Common and Druidic but doesn’t speak
cr: 7
traits:
  - name: False Appearance
    desc: "If the blight is motionless at the start of combat, it has advantage on its initiative roll. Moreover, if a creature hasn’t observed the blight move or act, that creature must succeed on a DC 18 Intelligence (Investigation) check to discern that the blight is animate."
  - name: Siege Monster
    desc: "The blight deals double damage to objects and structures."
actions:
  - name: Multiattack
    desc: "The blight makes one Branch attack and one Grasping Root attack."
  - name: Branch
    desc: "Melee Weapon Attack: +9 to hit, reach 15 ft., one target. Hit: 16 (3d6 + 6) bludgeoning damage."
  - name: Grasping Root
    desc: "Melee Weapon Attack: +9 to hit, reach 15 ft., one creature not grappled by the blight. Hit: The target is grappled (escape DC 15). Until the grapple ends, the target takes 9 (1d6 + 6) bludgeoning damage at the start of each of its turns. The root has AC 15 and can be severed by dealing 6 or more slashing damage to it on one attack. Cutting the root doesn’t hurt the blight but ends the grapple."
bonus_actions:
  - name: Bite
    desc: "Melee Weapon Attack: +9 to hit, reach 5 ft., one creature grappled by the blight. Hit: 19 (3d8 + 6) piercing damage."
```