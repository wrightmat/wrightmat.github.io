*In a land of ancient ruins, one clan attempts to revive the ultimate evil...*

### Background

Even with the Demon King Ganondorf gone, the Yiga have slowly gotten more organized and better prepared (especially after the death of their previous leader, Master Kohga). They have restructured into three specialized divisions, each led by a member who goes only by their title: Mighty Yiga, Monk Yiga, and Mage Yiga. The Mighty Yiga's group has claimed the Dusk Relic Chamber (beneath the Gerudo region, whereas the Gerudo have reclaimed the old Yiga hideout), and have stolen the young male child just born to the Gerudo. The Monk Yiga's group has claimed the Amber Relic Chamber, and are spending their time continuing experimentation with the Zonai technology that remains. And the Mage Yiga and his followers reside in the Jade Relic Chamber and is responsible for drawing the purple Malice-like substance from The Depths below and contaminating the various dungeons with it. The final boss is the new "Master Yiga" (with no actual name), an Astor (from Age of Calamity)-like character who is drawing power from the Poes in The Depths, but when he runs out of Poes to draw from he starts sacrificing Yiga Footsoldiers. The players might encounter him several times during the game, from a distance, gathering the souls.

### Dungeons

Twelve major dungeons throughout the world can be completed in any order, and will give major items after both the miniboss (elemental knights known as the "Heros") and boss (malice contaminated monster, or Yiga leader). At the end of each, the players will level up and get a medallion representing each temple's major element - which will be used to open up the final underground area with the final boss. They are presented in order of recommended completion, based on geographical area and difficulty. The final four underground dungeons, including the true final boss fight, are presented last.
```dataview
table without id file.link as Dungeon, Location, Theme-Mechanic, Miniboss, Miniboss-Treasure, Boss, Boss-Treasure, Reward
from #dungeon
sort Recommended-Order asc
```

### Side Adventures
```dataview
table without id file.link as Adventure, Reward
from #adventure and !#dungeon and !"_templates"
sort file.name asc
```

### Stables

There are nine Stables remaining throughout the land, including one that the players can buy (the others have closed down for various reasons over the years as Hyrule has developed further, especially in the Central Region).
```dataview
table without id file.link as Stable, Region, Primary-Purpose
from #stable
sort file.name asc
```

### Towers

There are seven Skyview Towers remaining from the Upheaval, which have been repurposed, primarily as military bases. Any others are presumed destroyed by decades without upkeep and with drastic weather conditions.
```dataview
table without id file.link as Tower, Region, Primary-Purpose
from #tower
sort file.name asc
```

### Factions

Various groups can be engaged throughout the game, to earn renown and possibly gain treasure or help.
```dataview
table without id file.link as Faction, Renown, Members, Alignment, Symbol
from #faction
sort file.name asc
```

### Regions

Post upheaval, the chasms have closed up, the cloud barrier has returned (isolating the sky islands once again and returning the fallen debris to its home), and some of the caves have even closed off again with time and geological activity. But each of the regions and races of Hyrule is responding to the post-upheaval period in a different way.
```dataview
list
from #region
sort Recommended-Order asc
```
