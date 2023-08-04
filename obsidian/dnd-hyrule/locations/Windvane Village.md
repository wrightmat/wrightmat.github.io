#location #village [[Hyrule Field]]

Located in the southwestern area of Hyrule Field, this medium-sized village has popped up since the Calamity/Upheaval and is occupied mostly by humans who don't want to live in Hyrule Castle Town.

This is inspired by Mabe Village from Link's Awakening, Kakariko from Link to the Past, and Windfall Island from Wind Waker.

### Locations

- Central Windvane
- Dream Shrine
- General Store
- Fortune Teller
- Milk Bar and Inn
- The Trendy Tailor
- Hylia Sanctuary

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
