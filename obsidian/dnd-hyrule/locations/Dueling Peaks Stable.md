#location #stable [[West Necluda]]

This is not a traditional stable, as the party can see that it's basically abandoned when they approach. The owner, Doza, is behind the counter. When approached, he explains that many of the stables in Hyrule are going under as the larger cities are re-building. In addition, there has been an evil energy emanating from a forest in the south that's driven people away. So he's looking to pick up and move on, and offers to sell the whole Stable to the party for 5,000 rupees. That will be enough for him to get a new start elsewhere.

>As you approach the Dueling Peaks Stable, you notice it doesn't match the usual description of a bustling hub of activity. There is nothing more than a few crates and a cooking pot outside of the stable. The usual notice board is completely blank. A friendly looking Hylian Retriever is running around the perimeter. Inside, the only individual appears to be an older Hylian male who looks noticeably tired.

If purchased, the party can use the Stable as a central base to use as they please. Details are in the mission below.

On the wall is a poster with the [[Epona Co.]] logo which depicts the notes for Epona's Song (see [[1. Central Windvane and Warp Songs]]).

Primary-Purpose:: Home Base
Region:: Necluda

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Company: Epona Co

![[Epona Co.]]
