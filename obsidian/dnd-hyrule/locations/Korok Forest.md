#location #village [[Great Hyrule Forest]]

The Great Deku Tree can be found in the middle of Korok Forest. The Koroks who live there reside both in and around the Great Deku Tree. To call it "village" is a bit of a stretch, as it lacks buildings or homes, with the Koroks apparently preferring to live in a natural setting.

### Locations
- Great Deku Tree
- General Shoppe
	- Hylian Rice
	- Tabantha Wheat
	- Apples
- Spore Store, a purveyor of fine goods
	- Mushrooms
	- Arrows
- Great Deku Tree's Navel, an inn
	- 
- The Witch's Hut, an alchemy and potion store

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

### Faction: Deku Protectorate

![[Deku Protectorate]]