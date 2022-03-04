+++
author = "오깅중"
title = "GCD(Grand Central Dispatch), Concurrency"
date = "2022-01-11"
description = "GCD, Concurrency를 알아보자!"
categories = [   

  "Swift"

]
tags = [
  "Concurrency",
  "GCD"
]
+++

# GCD

- iOS 개발에서 주로 사용되고 있는 동시성 프로그래밍 API, Swift 전 Objective-C부터 존재했던 개념이다.  
  GCD를 사용하면 async로 작업을 수행할 수 있고, 탈출 클로저를 이용한 completion handler를 통해 완료. 작업을 해주면 된다.!  
  Serial DispatchQueue, concurrent DispatchQueue 모두 작업 순서는 FIFO 이다.

### GCD예제

```swift
func testGCD(completion: (_ result: Int) -> Void) { 
  testGCD2 { result in 
     testGCD3 { value in 
        completion(value)
     }
  }
}
```

위 예제에는 두번의 콜백이 발생후 complection을 실행하기에 가독성이 크게 해치지 않지만 정말 만약에 점점 더 많은 콜백이 발생할 경우의 가독성은 생각만 해도 ~~끔직하다~~

### GCD 에러 핸들링

```swift
func testErrorHandler(completion: @escaping(Result?, Error?) -> Void) { 
  ...
  guard let result = result else { 
    completion(nil, Error)
    return
  }
}
```

GCD같은 경우에 completion에 데이터와 에러를 같이 보내주게 되는데 발생하는 결과마다 handler를 작성해야 하는 번거로움이 있다.

# Swift Concurrency

- 새로 소개된 동시성 프로그래밍 API이다. 무려 WWDC 2021에서 새로 나왔다. 동시성 프로그래밍을 가독성 좋게 깔끔하게 작성하고자 도입된 개념이다.  
  자세한 설명은 [Apple Develop](https://developer.apple.com/videos/play/wwdc2021/10132/)에서 확인하면 된다.!

### Concurrency 예제

```swift
func testGCD() async throws -> Int { 
  let firstResult = try await testGCD2()
  let secondResult = try await testGCD3()
  
  return secondResult
}
```

단순한 예제로만 봐도 가독성이 훨씬 좋아졌다. ~~나만 그런가?~~  

### Concurrency 에러 핸들링

```swift
func testErrorHandler() async throws -> Result { 
  ...
  guard let result = result else { 
    throw Error
  }
  
  return Result
}
```

Concurrency를 사용하게 되면 에러는 thorw로 데이터 전달은 return으로 분리 할 수 있다. 이렇게 되면 completion handler를 사용하지 않아 콜백이 없어지고 가독성 또한 좋아진다.

기존 GCD로 짜여있던 코드를 이제 Concurrency로 변환하여 가독성 높은 코드로 만들어 놔야겠다. ~~(언제바꾸지)~~😱
