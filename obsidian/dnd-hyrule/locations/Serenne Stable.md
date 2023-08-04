#location #stable [[Hyrule Ridge]]

>You were told that the Serene Stable was the place where adventurers could find work and avoid the hassle associated with other places in Hyrule. So far, that has been true. Madame Freona, a stout and officious Hylian who runs the stable with her five daughters, has proven an excellent hostess.

The primary animal raised at this stable is the moose, which have run wild over the Tabantha Tundra for as long as anyone can remember. Harlow tends to the moose outside, and mostly keeps to herself. This stable is larger than most, and tends to gather visitors to the many tables set up outside, due to Madame Freona's hospitality.

A poster on an inside wall depicts the notes to the "Prelude of Light" (see [[1. Central Windvane and Warp Songs]]).

When the players arrive, either ask them what time of day it is, or roll on the table below to determine which adventure will be presented to the players. If they arrive in the morning, then no adventure will be immediately presented but Freona will be available to serve drinks, offer a room, and give information. If they stay the night at the stable, start the morning with [[7. The Screams at Dawn]].

| d6  | Time of Day | Adventure                 |
| --- | ----------- | ------------------------- |
| 1   | Dawn        | The Screams at Dawn       |
| 2   | Morning     |                           |
| 3   | Afternoon   | The Dead at the Breach    |
| 4   | Evening     | A Shock at Dinner         |
| 5   | Dusk        | The Danger at Dusk        |
| 6   | Night       | The Meeting of the Seeker |

Primary-Purpose:: Moose
Region:: Hebra

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
