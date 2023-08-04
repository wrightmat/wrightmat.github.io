#location #stable [[Lake Hylia]]

The stables are a place where people can go to have a drink or meal and escape the tensions of the wilds of Hyrule. With the stables’ reputation as haven, adventurers who can be discreet and behave themselves can often find employment there. The primary animal tended at this stable is cows/bulls (tended by an older Haite).

>You've been told that the Highland Stable is a place where adventurers can find work and avoid the hassle associated with other places in Hyrule. In fact, the notice board outside is often full of requests for jobs. As you enter the stable, this would appear to be true. A number of nondescript individuals are seated at tables around the establishment, but one shorter than usual Gerudo in the corner grabs your attention - after all, Gerudo in this area of the world are exceedingly rare.

A poster on an inside wall depicts the notes to the "Minuet of Forest" (see [[1. Central Windvane and Warp Songs]]).

Primary-Purpose:: Cows
Region:: Faron

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
sort Type, Occupation, file.name
```

### Notice Board

 - "The Deku Protectorate is offering a significant sum of rupees to anyone who investigates and successfully clears the blight that has taken over the Hickaly Woods. Reward can be claimed in the Korok Forest. - Signed with a green swirl symbol" (Well in the Woods)
 - "Looking for adventure and treasure? Come see us at the Lurelin docks!"
