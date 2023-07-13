
### NPCs by Type

"Major" NPCs are those that should be listed first in the NPC list - they are leaders in their community, give important quests, or at least give valuable information if there aren't many NPCs in the area. "Medium" NPCs are listed next, and should have some important aspect to them that would make the players want to talk to them (and for the DM to mention them specifically when describing an area). "Minor" NPCs will be listed last in the NPC list, and are for any remaining NPCs which are around, but may not be immediately useful (although could become useful if engaged by the players).

When describing a new area, focusing on the creatures at the top of the list, and only mentioning the first several, is a good rule of thumb. If players ask for a specific NPC, or continue to ask about other people in the area, you can work your way down the list. Or use the Occupation column to pick out NPCs that are situationally important.

#### Major NPCs
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Location, Comments
from #npc and "characters"
where Type = "Major"
sort file.name
```

#### Medium NPCs
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Location, Comments
from #npc and "characters"
where Type = "Medium"
sort file.name
```

#### Minor NPCs
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Location, Comments
from #npc and "characters"
where Type = "Minor"
sort file.name
```

#### Unclassified NPCs
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc and "characters"
where !Type
sort Occupation, file.name
```

### NPCs by Occupation

```dataview
table without id Occupation, file.link as Name, Race, Gender, Age, Location, Comments
from #npc and "characters"
sort Occupation, file.name
```

### NPCs by Location

```dataview
table without id Location, file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc and "characters"
sort Location, file.name
```

### NPC Bio Counts

```dataview
table without id Race, length(rows) as Count
from #npc and "characters"
group by Race
```

```dataview
table without id Gender, length(rows) as Count
from #npc and "characters"
group by Gender
```

```dataview
table without id Age, length(rows) as Count
from #npc and "characters"
group by Age
```

```dataview
table without id Sexuality, length(rows) as Count
from #npc and "characters"
group by Sexuality
```
