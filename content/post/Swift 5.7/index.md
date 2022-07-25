+++

author = "오깅중"

title = "Swift 5.7 개선 사항!!"

date = "2022-06-15"

description = "Swift 5.7 개선 사항"

categories = [  

 "Swift"

]

tags = [

 "Swift, Swift 5,7"

]

+++

# Swift 5.7 개선 사항

Swift 5.7이 소개되면서 개발자들에게 많은 부분에서 편의성을 제공하려는 모습이 보이는거 같다

일단 다양한 개선 사항이 있는데, SPM성능 향상, 표준 라이브러리 향상, 빌드 속도 향상 Swift의 편의성 등등 다양한 개선사항이 소개 됐다!!

그중에 개발하면서 유용하게 쓰일 Swift Language 개선 사항을 중점으로 소개해 보려고 한다.

### if let shorthand for unwrapping optionals

많은 개발자들이 옵셔설 언래핑을 진행할때 `if let`, `guard let` 등을 통해 진행 하고 계실건데 이전에는 아래와 같은 쉐도잉 작업이 필요했더랬죠?

```swift
var test: Int? = 0

if let test = test { 
  print(test)
}
```

쉐도잉이라 함은 if, guard 문에서 사용될 프로퍼티레 옵셔널 값을 추출한 겁니다!!

다시 말해 위에 있는 if 블록을 말하는거죠

지금은 너무나 익숙해져서 큰 불편함이 없지만 어쩔수 없이 변수명을 길게 사용할때가 되면 길어지는 코드에 어지럼을 느끼고 애매한 줄바꿈을 진행해야 할때가 분명 있으셨을거에요ㅎㅎ.. ~~전 그랬거든요~~

```swift
var wwdcPresentationContentFromOptional: String? = "GOOD"

if let content = wwdcPresentationContentFromOptional { 
  print(content)
}
```

이런식으로 좀 애매하게 줄이게 되더라고요.. 좀 더 정확한 변수명을 원해서 변수이름을 길게 써줬는데? 언래핑을 해줄때 다시 애매해지는 경향이 있더라고요???

그런데 이제 Swift 5.7에서는 이런 부분을 줄일수 있게 해줬더라고요

```swift
var content: String? = "GOOD"

if let content { 
  print(content)
}
```

어때요 굉장히 맘에 들지 않나요???? 전 무척 맘에 들더라고요

> 아주 간단하게 사용할수 있어서 굉장히 좋아 보이더라고요👏🏻

### Multi-statement closure type inference

이제 클로져에서 반환타입을 가질때 자동 타입추론을 해줘서 명시적으로 반환 타입을 적어줄 필요가 없어지게 됐답니다!!

이전에는 반드시 반환타입을 작성해 줬더라면 이제는

```swift
let test = [0, 20, 30, 50]

let test2 = test.map { number in 
 	return "Test number is \(number)"                      
}
```

> 안드의 타입추론을 이제 부러워 하지 않아도 되겠네요 ㅎㅎ..

### 결론

개발하기 편한 환경을 만들어 주기 위해 많은 노력을 해주는걸로 보이네요😁

좀 더 많은 개선 사항이 있으니까 천천히 다시 읽어봐야겠어요✍️



### 참고자료

https://www.hackingwithswift.com/articles/249/whats-new-in-swift-5-7
