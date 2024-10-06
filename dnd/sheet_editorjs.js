import Header from '@editorjs/header'; 
import List from '@editorjs/list'; 

const editor = new EditorJS({
  holder: 'editorjs', 
  tools: { 
    header: Header, 
    list: List 
  }, 
})