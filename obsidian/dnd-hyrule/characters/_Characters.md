---

database-plugin: basic

---

```yaml:dbfolder
name: _Characters
description: 
columns:
  Race:
    input: select
    accessorKey: Race
    label: Race
    key: Race
    id: Race
    position: 2
    skipPersist: false
    isHidden: false
    sortIndex: 1
    width: 81
    isSorted: true
    isSortedDesc: false
    options:
      - { label: "Gerudo", value: "Gerudo", color: "hsl(44, 95%, 90%)"}
      - { label: "Hylian", value: "Hylian", color: "hsl(318, 95%, 90%)"}
      - { label: "Goron", value: "Goron", color: "hsl(288, 95%, 90%)"}
      - { label: "Rito", value: "Rito", color: "hsl(258, 95%, 90%)"}
      - { label: "Zora", value: "Zora", color: "hsl(162, 95%, 90%)"}
      - { label: "Deku Scrub", value: "Deku Scrub", color: "hsl(244, 95%, 90%)"}
      - { label: "Korok", value: "Korok", color: "hsl(148, 95%, 90%)"}
      - { label: "Great Fairy", value: "Great Fairy", color: "hsl(76, 95%, 90%)"}
      - { label: "Dragon", value: "Dragon", color: "hsl(308, 95%, 90%)"}
      - { label: "Horse", value: "Horse", color: "hsl(271, 95%, 90%)"}
      - { label: "Tree/Deity", value: "Tree/Deity", color: "hsl(20, 95%, 90%)"}
      - { label: "Horse Fairy", value: "Horse Fairy", color: "hsl(322, 95%, 90%)"}
      - { label: "Dara", value: "Dara", color: "hsl(144, 95%, 90%)"}
      - { label: "Rite", value: "Rite", color: "hsl(359, 95%, 90%)"}
      - { label: "Subrosian", value: "Subrosian", color: "hsl(169, 95%, 90%)"}
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
      option_source: manual
  Gender:
    input: select
    accessorKey: Gender
    label: Gender
    key: Gender
    id: Gender
    position: 3
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 69
    options:
      - { label: "Female", value: "Female", color: "hsl(0, 95%, 90%)"}
      - { label: "Male", value: "Male", color: "hsl(244, 95%, 90%)"}
      - { label: "Non-Binary", value: "Non-Binary", color: "hsl(18, 95%, 90%)"}
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Age:
    input: select
    accessorKey: Age
    label: Age
    key: Age
    id: Age
    position: 4
    skipPersist: false
    isHidden: false
    sortIndex: -1
    isSorted: false
    isSortedDesc: false
    options:
      - { label: "Middle Aged", value: "Middle Aged", color: "hsl(270, 95%, 90%)"}
      - { label: "Older Adult", value: "Older Adult", color: "hsl(7, 95%, 90%)"}
      - { label: "Elderly", value: "Elderly", color: "hsl(235, 95%, 90%)"}
      - { label: "Child", value: "Child", color: "hsl(95, 95%, 90%)"}
      - { label: "Adult", value: "Adult", color: "hsl(133, 95%, 90%)"}
      - { label: "Young Adult", value: "Young Adult", color: "hsl(316, 95%, 90%)"}
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Location:
    input: text
    accessorKey: Location
    label: Location
    key: Location
    id: Location
    position: 7
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 190
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Occupation:
    input: text
    accessorKey: Occupation
    label: Occupation
    key: Occupation
    id: Occupation
    position: 8
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 146
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Type:
    input: select
    accessorKey: Type
    label: Type
    key: Type
    id: Type
    position: 9
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 56
    options:
      - { label: "Minor", value: "Minor", color: "hsl(271, 95%, 90%)"}
      - { label: "Medium", value: "Medium", color: "hsl(13, 95%, 90%)"}
      - { label: "Major", value: "Major", color: "hsl(336, 95%, 90%)"}
      - { label: "MInor", value: "MInor", color: "hsl(293, 95%, 90%)"}
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Comments:
    input: text
    accessorKey: Comments
    label: Comments
    key: Comments
    id: Comments
    position: 10
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 125
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Adventure:
    input: text
    accessorKey: Adventure
    label: Adventure
    key: Adventure
    id: Adventure
    position: 12
    skipPersist: false
    isHidden: false
    sortIndex: -1
    isSorted: false
    isSortedDesc: false
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  __file__:
    key: __file__
    id: __file__
    input: markdown
    label: File
    accessorKey: __file__
    isMetadata: true
    skipPersist: false
    isDragDisabled: false
    csvCandidate: true
    position: 1
    width: 81
    isHidden: false
    sortIndex: -1
    isSorted: false
    isSortedDesc: false
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: true
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Sexuality:
    input: select
    accessorKey: Sexuality
    key: Sexuality
    id: Sexuality
    label: Sexuality
    position: 5
    skipPersist: false
    isHidden: false
    sortIndex: -1
    options:
      - { label: "Heterosexual", value: "Heterosexual", color: "hsl(1, 95%, 90%)"}
      - { label: "Homosexual", value: "Homosexual", color: "hsl(350, 95%, 90%)"}
      - { label: "Asexual", value: "Asexual", color: "hsl(67, 95%, 90%)"}
      - { label: "Bisexual", value: "Bisexual", color: "hsl(227, 95%, 90%)"}
      - { label: "hrt", value: "hrt", color: "hsl(65, 95%, 90%)"}
      - { label: "nis", value: "nis", color: "hsl(26, 95%, 90%)"}
      - { label: "ye", value: "ye", color: "hsl(238, 95%, 90%)"}
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
      option_source: manual
  Alignment:
    input: select
    accessorKey: Alignment
    key: Alignment
    id: Alignment
    label: Alignment
    position: 6
    skipPersist: false
    isHidden: false
    sortIndex: -1
    options:
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Alias:
    input: text
    accessorKey: Alias
    key: Alias
    id: Alias
    label: Alias
    position: 100
    skipPersist: false
    isHidden: false
    sortIndex: -1
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
  Relationships:
    input: text
    accessorKey: Relationships
    label: Relationships
    key: Relationships
    id: Family
    position: 11
    skipPersist: false
    isHidden: false
    sortIndex: -1
    width: 126
    config:
      enable_media_view: true
      link_alias_enabled: true
      media_width: 100
      media_height: 100
      isInline: false
      task_hide_completed: true
      footer_type: none
      persist_changes: false
config:
  remove_field_when_delete_column: false
  cell_size: normal
  sticky_first_column: false
  group_folder_column: 
  remove_empty_folders: false
  automatically_group_files: false
  hoist_files_with_empty_attributes: true
  show_metadata_created: false
  show_metadata_modified: false
  show_metadata_tasks: false
  show_metadata_inlinks: false
  show_metadata_outlinks: false
  show_metadata_tags: false
  source_data: current_folder
  source_form_result: 
  source_destination_path: /
  row_templates_folder: /
  current_row_template: 
  pagination_size: 200
  font_size: 12
  enable_js_formulas: false
  formula_folder_path: /
  inline_default: false
  inline_new_position: last_field
  date_format: yyyy-MM-dd
  datetime_format: "yyyy-MM-dd HH:mm:ss"
  metadata_date_format: "yyyy-MM-dd HH:mm:ss"
  enable_footer: false
  implementation: default
filters:
  enabled: false
  conditions:
```