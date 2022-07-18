+++

author = "오깅중"

title = "UIStackView Animation show/hide 버그"

date = "2022-04-13"

description = "UIStackView 애니메이션 적용시 버그 해결!"

categories = [  

 "Swift"

]

tags = [

 "UIStackView"

]

+++

### 문제점

먼저 UIStackView에서 hidden property를 사용하여 숨김?을 처리하게 되면 이게 이상하게 지속적으로 stack에 쌓이게 된다. 

이게 무슨말이냐면 숨김 버튼을 계속 누르게 되면 누른 만큼 stackview는 숨겨진다고 생각하면 되는데 5번 누르면 show를 5번 눌러줘야 다시 화면에 나타난다.

처음에 코드를 잘못 짠줄 알고 디버그를 엄청 열심히 해봤는데 코드는 이상이 없고 코드는 거짓말을 하지 않는다고 하지만 진짜 거짓말 당하는 기분이 들었었다.

### 해결방법

```swift
func testShow() { 
  guard isHidden else { return }        
  isHidden = false
}

func testHide() { 
  guard !isHidden else { return }
  isHidden = true
}

```

일단 저는 이렇게 UIView Extension을 만들어서 사용하고 있습니다.



그럼 끗!

### 참고사이트

- https://stackoverflow.com/questions/33240635/hidden-property-cannot-be-changed-within-an-animation-block

- https://stackoverflow.com/questions/43831695/stackview-ishidden-attribute-not-updating-as-expected

