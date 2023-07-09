#location #town [[Akkala Region]]

Akkala Citadel Town

### Locations

- **Torin Tavern**: Headquarters of the Soldiers' Guild
- Soldiers' Academy
- Quartermaster
- Infirmary
- Barracks
	- Cot (20 rupees)
- Parade Grounds

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

### Faction: Soldiers' Guild

![[Soldiers' Guild]]
