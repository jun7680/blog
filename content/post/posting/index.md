---
title: Notion으로 Posting
description: Notion으로 jekyll에 포스팅하기
date: 2020-12-23
slug: Notion
image: notion_logo.png
tags: 
    - Markdown
    - jekyll
    - Notion
categories:
    - Notion
    - jekyll
---

### 글 작성
```markdown
---
layout: post
title: 제목
subtitle: 부제목
date: 글 작성 시간
categories: 카테고리
tags: 테그 or [테그, 테그....]
comments: true <- 댓글 사용 여부
---
```
--- 
<h4>layout - 내가 사용한 테마에서는 글 작성시 post, 페이지(상단) 추가시 page.</h4>
 
<h4>title, subtitle 둘다 문자열로 입력.</h4>
  
~~처음에 마크다운 문법 에러가 계속 났었는데 알고보니 따옴표...~~  
~~노션이나 다른 곳에서 복사해서 사용할 경우 따옴표에 주의해야 한다.~~ 

- 글 작성후 _post라는 폴더 안에 md파일을 넣어준다.

- md파일을 넣을때 **yyyy-mm-dd-제목** 의 형식을 맞춰서 넣어줘야 포스팅 된다.
