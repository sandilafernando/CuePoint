/**
 * React 19 removed the global `JSX` namespace from `@types/react`.
 *
 * CuePoint's components annotate their return type as `JSX.Element`, which is the form most
 * people read as "a React element". This declaration aliases the global namespace to React's
 * own, so those annotations keep working without a project-wide rewrite.
 */
import type { JSX as ReactJSX } from 'react'

declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    type ElementClass = ReactJSX.ElementClass
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}

export {}
