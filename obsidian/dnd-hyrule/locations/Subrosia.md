#location #city [[Underground]]

Subrosia is a subterranean lava world located beneath the Underground of Hyrule, and is home to the Subrosians. This area serves as a refuse and base for the party while Underground, prior to descending to The Depths to face the Final Battle.

### Locations

- **Subrosia Smithy**
- Subrosia Square
- Subrosia Store
- Lava Lake
- Desert of Doubt
- Fields of Flame
- Blazing Beaches

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

**Subrosia Smithy**: If the PCs are able to provide the ore chunks, then Saaro at the Smithy can upgrade any metal piece of armor or weapon that the PCs carry to a +2 magical version using his magical forge. Some sort of mission to gather ore chunks?
