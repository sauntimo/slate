import getDirection from 'direction'
import invariant from 'tiny-invariant'
import warning from 'tiny-warning'
import { List, OrderedSet, Set, Stack } from 'immutable'

import mixin from '../utils/mixin'
import Block from '../models/block'
import Decoration from '../models/decoration'
import Document from '../models/document'
import Inline from '../models/inline'
import memoize from '../utils/memoize'
import PathUtils from '../utils/path-utils'
import Point from '../models/point'
import Range from '../models/range'
import Selection from '../models/selection'
import Value from '../models/value'
import Operation from '../models/operation'

/**
 * The interface that `Document`, `Block` and `Inline` all implement, to make
 * working with the recursive node tree easier.
 *
 * @type {Class}
 */

class ElementInterface {
  /**
   * Get the concatenated text of the node.
   *
   * @return {String}
   */

  get text() {
    return this.getText()
  }

  /**
   * Add `mark` to text at `path`.
   *
   * @param {List|String} path
   * @param {Mark} mark
   * @return {Node}
   */

  addMark(path, mark) {
    path = this.resolvePath(path)
    let node = this.assertDescendant(path)
    node = node.addMark(mark)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Create an iteratable for all of the ancestors of the node.
   *
   * @return {Iterable}
   */

  ancestors(path) {
    const iterable = this.createIterable({
      path,
      direction: null,
      downward: false,
      includeAncestors: true,
      includeRoot: true,
    })

    return iterable
  }

  /**
   * Create an iteratable for all of the blocks of a node with `options`.
   *
   * @param {Options}
   * @return {Iterable}
   */

  blocks(options = {}) {
    const { leaf = false, type = null } = options
    const iterable = this.createIterable({
      path: [],
      objects: ['block'],
      types: type ? [type] : null,
      match: leaf ? node => node.isLeafBlock() : null,
    })

    return iterable
  }

  /**
   * Create a decoration with `properties` relative to the node.
   *
   * @param {Object|Decoration} properties
   * @return {Decoration}
   */

  createDecoration(properties) {
    properties = Decoration.createProperties(properties)
    const decoration = this.resolveDecoration(properties)
    return decoration
  }

  /**
   * Create an iteratable function starting at `target` path with `options`.
   *
   * @param {Object} options (optional)
   * @return {Function}
   */

  createIterable(options = {}) {
    const {
      includeTarget = false,
      includeAncestors = false,
      includeRoot = false,
      direction = 'forward',
      upward = true,
      downward = true,
      objects = null,
      types = null,
      match = null,
    } = options

    const root = this
    let targetPath = null
    let targetRange = null

    if (options.range) {
      targetRange = root.resolveRange(options.range)
    }

    if (options.path) {
      targetPath = root.resolvePath(options.path)
    } else if (targetRange) {
      targetPath = root.resolvePath(targetRange.start.path)
    }

    const targetNode = targetPath && root.assertNode(targetPath)
    const NativeSet = typeof window === 'undefined' ? global.Set : window.Set

    const generate = () => {
      const visited = new NativeSet()
      const startPath = targetRange && targetRange.start.path
      const endPath = targetRange && targetRange.end.path
      let path = targetPath
      let node = targetNode
      let includedTarget = false
      let includedStart = false
      let includingStart = false

      const result = () => {
        if (!path || !node) {
          return { done: true }
        }

        if (!includeRoot && node === root) {
          return next()
        }

        if (objects && !objects.includes(node.object)) {
          return next()
        }

        if (types && !types.includes(node.type)) {
          return next()
        }

        if (match && !match(node, path)) {
          return next()
        }

        return { value: [node, path], done: false }
      }

      const next = () => {
        if (!path || !node) {
          return result()
        }

        if (startPath && !includedStart) {
          if (!includingStart) {
            includingStart = true
            path = PathUtils.create([])
            node = root
            return result()
          }

          if (path.size === startPath.size - 1) {
            includedStart = true
            path = targetPath
            node = targetNode
            return next()
          }

          path = startPath.slice(0, path.size + 1)
          node = root.assertNode(path)
          return result()
        }

        if (includeTarget && !includedTarget) {
          includedTarget = true
          return result()
        }

        if (endPath && path.equals(endPath)) {
          node = null
          path = null
          return next()
        }

        if (downward && node.nodes && node.nodes.size && !visited.has(node)) {
          visited.add(node)
          const nextIndex = direction === 'forward' ? 0 : node.nodes.size - 1
          path = path.push(nextIndex)
          node = root.assertNode(path)
          return result()
        }

        if (direction === 'forward') {
          const newPath = PathUtils.increment(path)
          const newNode = root.getNode(newPath)

          if (newNode) {
            path = newPath
            node = newNode
            return result()
          }
        }

        if (direction === 'backward' && path.last() !== 0) {
          const newPath = PathUtils.decrement(path)
          const newNode = root.getNode(newPath)

          if (newNode) {
            path = newPath
            node = newNode
            return result()
          }
        }

        if (upward && path.size) {
          path = PathUtils.lift(path)
          node = root.assertNode(path)

          if (visited.has(node)) {
            return next()
          }

          visited.add(node)

          if (!includeAncestors) {
            return next()
          } else {
            return result()
          }
        }

        path = null
        node = null
        return next()
      }

      return { next }
    }

    return { [Symbol.iterator]: generate }
  }

  /**
   * Create a point with `properties` relative to the node.
   *
   * @param {Object|Point} properties
   * @return {Range}
   */

  createPoint(properties) {
    properties = Point.createProperties(properties)
    const point = this.resolvePoint(properties)
    return point
  }

  /**
   * Create a range with `properties` relative to the node.
   *
   * @param {Object|Range} properties
   * @return {Range}
   */

  createRange(properties) {
    properties = Range.createProperties(properties)
    const range = this.resolveRange(properties)
    return range
  }

  /**
   * Create a selection with `properties` relative to the node.
   *
   * @param {Object|Selection} properties
   * @return {Selection}
   */

  createSelection(properties) {
    properties = Selection.createProperties(properties)
    const selection = this.resolveSelection(properties)
    return selection
  }

  /**
   * Create an iteratable for all of the descendants of the node.
   *
   * @return {Iterable}
   */

  descendants() {
    const iterable = this.createIterable({ path: [] })
    return iterable
  }

  /**
   * Find all of the descendants that match a `predicate`.
   *
   * @param {Function} predicate
   * @return {List<Node>}
   */

  filterDescendants(predicate) {
    const matches = []

    for (const [node, path] of this.descendants()) {
      if (predicate(node, path)) {
        matches.push(node)
      }
    }

    return List(matches)
  }

  /**
   * Find the first descendant that matches a `predicate`.
   *
   * @param {Function} predicate
   * @return {Node|Null}
   */

  findDescendant(predicate) {
    for (const [node, path] of this.descendants()) {
      if (predicate(node, path)) {
        return node
      }
    }

    return null
  }

  /**
   * Iterate over all descendants, breaking if `predicate` returns false.
   *
   * @param {Function} predicate
   */

  forEachDescendant(predicate) {
    for (const next of this.descendants()) {
      const ret = predicate(...next)

      if (ret === false) {
        return
      }
    }
  }

  /**
   * Get a set of the active marks in a `range`.
   *
   * @param {Range} range
   * @return {Set<Mark>}
   */

  getActiveMarksAtRange(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return Set()

    if (range.isCollapsed) {
      const { start } = range
      return this.getMarksAtPosition(start.path, start.offset).toSet()
    }

    const { start, end } = range
    let startPath = start.path
    let startOffset = start.offset
    let endPath = end.path
    let endOffset = end.offset
    let startText = this.getDescendant(startPath)
    let endText = this.getDescendant(endPath)

    if (!PathUtils.isEqual(startPath, endPath)) {
      while (!PathUtils.isEqual(startPath, endPath) && endOffset === 0) {
        ;[[endText, endPath]] = this.previousTexts(endPath)
        endOffset = endText.text.length
      }

      while (
        !PathUtils.isEqual(startPath, endPath) &&
        startOffset === startText.text.length
      ) {
        ;[[startText, startPath]] = this.nextTexts(startPath)
        startOffset = 0
      }
    }

    if (PathUtils.isEqual(startPath, endPath)) {
      return startText.marks
    }

    const startMarks = startText.marks

    // PERF: if start marks is empty we can return early.
    if (startMarks.size === 0) {
      return Set()
    }

    const endMarks = endText.marks
    let marks = startMarks.intersect(endMarks)

    // If marks is already empty, the active marks is empty
    if (marks.size === 0) {
      return marks
    }

    ;[[startText, startPath]] = this.nextTexts(startPath)

    while (!PathUtils.isEqual(startPath, endPath)) {
      if (startText.text.length !== 0) {
        marks = marks.intersect(startText.marks)

        if (marks.size === 0) {
          return Set()
        }
      }

      ;[[startText, startPath]] = this.nextTexts(startPath)
    }

    return marks
  }

  /**
   * Get a list of the ancestors of a descendant.
   *
   * @param {List|String} path
   * @return {List<Node>|Null}
   */

  getAncestors(path) {
    path = this.resolvePath(path)

    if (!path) {
      return null
    }

    const array = Array.from(this.ancestors(path), ([node]) => node).reverse()
    return List(array)
  }

  /**
   * Get the leaf block descendants of the node.
   *
   * @return {List<Node>}
   */

  getBlocks() {
    const array = this.getBlocksAsArray()
    return List(array)
  }

  /**
   * Get the leaf block descendants of the node.
   *
   * @return {List<Node>}
   */

  getBlocksAsArray() {
    const array = Array.from(this.blocks({ leaf: true }), ([node]) => node)
    return array
  }

  /**
   * Get all of the leaf blocks that match a `type`.
   *
   * @param {String} type
   * @return {List<Node>}
   */

  getBlocksByType(type) {
    const array = this.getBlocksByTypeAsArray(type)
    return List(array)
  }

  /**
   * Get all of the leaf blocks that match a `type` as an array
   *
   * @param {String} type
   * @return {Array}
   */

  getBlocksByTypeAsArray(type) {
    const array = Array.from(
      this.blocks({ leaf: true, type }),
      ([node]) => node
    )
    return array
  }

  /**
   * Get a child node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getChild(path) {
    path = this.resolvePath(path)
    if (!path || path.size > 1) return null
    const child = this.nodes.get(path.first())
    return child
  }

  /**
   * Get closest parent of node that matches a `predicate`.
   *
   * @param {List|String} path
   * @param {Function} predicate
   * @return {Node|Null}
   */

  getClosest(path, predicate) {
    for (const [n, p] of this.ancestors(path)) {
      if (predicate(n, p)) {
        return n
      }
    }

    return null
  }

  /**
   * Get the closest block parent of a node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getClosestBlock(path) {
    const closest = this.getClosest(path, n => n.object === 'block')
    return closest
  }

  /**
   * Get the closest inline parent of a node by `path`.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getClosestInline(path) {
    const closest = this.getClosest(path, n => n.object === 'inline')
    return closest
  }

  /**
   * Get the closest void parent of a node by `path`.
   *
   * @param {List|String} path
   * @param {Editor} editor
   * @return {Node|Null}
   */

  getClosestVoid(path, editor) {
    invariant(
      !Value.isValue(editor),
      'As of Slate 0.42.0, the `node.getClosestVoid` method takes an `editor` instead of a `value`.'
    )

    const closest = this.getClosest(path, n => editor.isVoid(n))
    return closest
  }

  /**
   * Get the common ancestor of nodes `a` and `b`.
   *
   * @param {List} a
   * @param {List} b
   * @return {Node}
   */

  getCommonAncestor(a, b) {
    a = this.resolvePath(a)
    b = this.resolvePath(b)
    if (!a || !b) return null

    const path = PathUtils.relate(a, b)
    const node = this.getNode(path)
    return node
  }

  /**
   * Get the decorations for the node from an `editor`.
   *
   * @param {Editor} editor
   * @return {List}
   */

  getDecorations(editor) {
    invariant(
      !Value.isValue(editor),
      'As of Slate 0.42.0, the `node.getDecorations` method takes an `editor` instead of a `value`.'
    )

    const array = editor.run('decorateNode', this)
    const decorations = Decoration.createList(array)
    return decorations
  }

  /**
   * Get the depth of a descendant, with optional `startAt`.
   *
   * @param {List|String} path
   * @param {Number} startAt
   * @return {Number|Null}
   */

  getDepth(path, startAt = 1) {
    path = this.resolvePath(path)
    if (!path) return null

    const node = this.getNode(path)
    const depth = node ? path.size - 1 + startAt : null
    return depth
  }

  /**
   * Get a descendant node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getDescendant(path) {
    path = this.resolvePath(path)
    if (!path || !path.size) return null

    let node = this

    path.forEach(index => {
      node = node.getIn(['nodes', index])
      return !!node
    })

    return node
  }

  /**
   * Get a fragment of the node at a `range`.
   *
   * @param {Range} range
   * @return {Document}
   */

  getFragmentAtRange(range) {
    range = this.resolveRange(range)

    if (range.isUnset) {
      return Document.create()
    }

    const { start, end } = range
    let node = this
    let targetPath = end.path
    let targetPosition = end.offset
    let mode = 'end'

    while (targetPath.size) {
      const index = targetPath.last()
      node = node.splitNode(targetPath, targetPosition)
      targetPosition = index + 1
      targetPath = PathUtils.lift(targetPath)

      if (!targetPath.size && mode === 'end') {
        targetPath = start.path
        targetPosition = start.offset
        mode = 'start'
      }
    }

    const startIndex = start.path.first() + 1
    const endIndex = end.path.first() + 2
    const nodes = node.nodes.slice(startIndex, endIndex)
    const fragment = Document.create({ nodes })
    return fragment
  }

  /**
   * Get the furthest ancestors of a node that matches a `predicate`.
   *
   * @param {Path} path
   * @param {Function} predicate
   * @return {Node|Null}
   */

  getFurthest(path, predicate) {
    const results = Array.from(this.ancestors(path)).reverse()

    for (const [n, p] of results) {
      if (predicate(n, p)) {
        return n
      }
    }

    return null
  }

  /**
   * Get the furthest ancestor of a node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getFurthestAncestor(path) {
    path = this.resolvePath(path)
    if (!path || !path.size) return null
    const furthest = this.nodes.get(path.first())
    return furthest
  }

  /**
   * Get the furthest block parent of a node.
   *
   * @param {Path} path
   * @return {Node|Null}
   */

  getFurthestBlock(path) {
    const furthest = this.getFurthest(path, n => n.object === 'block')
    return furthest
  }

  /**
   * Get the furthest inline parent of a node.
   *
   * @param {Path} path
   * @return {Node|Null}
   */

  getFurthestInline(path) {
    const furthest = this.getFurthest(path, n => n.object === 'inline')
    return furthest
  }

  /**
   * Get the furthest ancestor of a node, where all ancestors to that point only have one child.
   *
   * @param {Path} path
   * @return {Node|Null}
   */

  getFurthestOnlyChildAncestor(path) {
    const ancestors = this.getAncestors(path)
    if (!ancestors) return null

    const furthest = ancestors
      .rest()
      .reverse()
      .takeUntil(p => p.nodes.size > 1)
      .last()

    return furthest || null
  }

  /**
   * Get the closest inline nodes for each text node in the node.
   *
   * @return {List<Node>}
   */

  getInlines() {
    const array = this.getInlinesAsArray()
    const list = List(array)
    return list
  }

  /**
   * Get the closest inline nodes for each text node in the node, as an array.
   *
   * @return {Array<Node>}
   */

  getInlinesAsArray() {
    const array = Array.from(this.inlines({ leaf: true }), ([node]) => node)
    return array
  }

  /**
   * Get all of the leaf inline nodes that match a `type`.
   *
   * @param {String} type
   * @return {List<Node>}
   */

  getInlinesByType(type) {
    const array = this.getInlinesByTypeAsArray(type)
    const list = List(array)
    return list
  }

  /**
   * Get all of the leaf inline nodes that match a `type` as an array.
   *
   * @param {String} type
   * @return {Array}
   */

  getInlinesByTypeAsArray(type) {
    const array = Array.from(
      this.inlines({ leaf: true, type }),
      ([node]) => node
    )
    return array
  }

  /**
   * Get a set of the marks in a `range`.
   *
   * @param {Range} range
   * @return {Set<Mark>}
   */

  getInsertMarksAtRange(range) {
    range = this.resolveRange(range)
    const { start } = range

    if (range.isUnset) {
      return Set()
    }

    if (range.isCollapsed) {
      // PERF: range is not cachable, use key and offset as proxies for cache
      return this.getMarksAtPosition(start.path, start.offset)
    }

    const text = this.getDescendant(start.path)
    const { marks } = text
    return marks
  }

  /**
   * Get the bottom-most block descendants in a `range`.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getLeafBlocksAtRange(range) {
    const array = this.getLeafBlocksAtRangeAsArray(range)
    // Eliminate duplicates by converting to an `OrderedSet` first.
    return List(OrderedSet(array))
  }

  /**
   * Get the bottom-most descendants in a `range` as an array
   *
   * @param {Range} range
   * @return {Array<Node>}
   */

  getLeafBlocksAtRangeAsArray(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return []

    const { start, end } = range

    return this.getLeafBlocksBetweenPathPositionsAsArray(start.path, end.path)
  }

  /**
   * Get the bottom-most descendants between two paths as an array
   *
   * @param {List|Null} startPath
   * @param {List|Null} endPath
   * @return {Array<Node>}
   */

  getLeafBlocksBetweenPathPositionsAsArray(startPath, endPath) {
    // PERF: the most common case is when the range is in a single block node,
    // where we can avoid a lot of iterating of the tree.
    if (startPath && endPath && PathUtils.isEqual(startPath, endPath)) {
      return [this.getClosestBlock(startPath)]
    } else if (!startPath && !endPath) {
      return this.getBlocksAsArray()
    }

    const startIndex = startPath ? startPath.get(0, 0) : 0
    const endIndex = endPath
      ? endPath.get(0, this.nodes.size - 1)
      : this.nodes.size - 1

    let array = []

    this.nodes.slice(startIndex, endIndex + 1).forEach((node, i) => {
      if (node.object !== 'block') {
        return
      } else if (node.isLeafBlock()) {
        array.push(node)
      } else {
        const childStartPath =
          startPath && i === 0 ? PathUtils.drop(startPath) : null
        const childEndPath =
          endPath && i === endIndex - startIndex
            ? PathUtils.drop(endPath)
            : null

        array = array.concat(
          node.getLeafBlocksBetweenPathPositionsAsArray(
            childStartPath,
            childEndPath
          )
        )
      }
    })

    return array
  }

  /**
   * Get the bottom-most inline nodes for each text node in a `range`.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getLeafInlinesAtRange(range) {
    const array = this.getLeafInlinesAtRangeAsArray(range)
    // Remove duplicates by converting it to an `OrderedSet` first.
    const list = List(OrderedSet(array))
    return list
  }

  /**
   * Get the bottom-most inline nodes for each text node in a `range` as an array.
   *
   * @param {Range} range
   * @return {Array<Node>}
   */

  getLeafInlinesAtRangeAsArray(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return []

    const array = this.getTextsAtRangeAsArray(range)
      .map(text => this.getClosestInline(text.key))
      .filter(exists => exists)

    return array
  }

  /**
   * Get an object mapping all the keys in the node to their paths.
   *
   * @return {Map}
   */

  getNodesToPathsMap() {
    const root = this
    const map =
      typeof window === 'undefined' ? new global.Map() : new window.Map()

    map.set(root, PathUtils.create([]))

    root.forEachDescendant((node, path) => {
      map.set(node, path)
    })

    return map
  }

  /**
   * Get all of the marks for all of the characters of every text node.
   *
   * @return {Set<Mark>}
   */

  getMarks() {
    const array = this.getMarksAsArray()
    return Set(array)
  }

  /**
   * Get all of the marks as an array.
   *
   * @return {Array}
   */

  getMarksAsArray() {
    const result = []

    for (const [node] of this.texts()) {
      result.push(node.marks.toArray())
    }

    // PERF: use only one concat rather than multiple for speed.
    const array = [].concat(...result)
    return array
  }

  /**
   * Get a set of marks in a `position`, the equivalent of a collapsed range
   *
   * @param {List|string} key
   * @param {number} offset
   * @return {Set}
   */

  getMarksAtPosition(path, offset) {
    path = this.resolvePath(path)
    const text = this.getDescendant(path)
    const currentMarks = text.marks

    if (offset !== 0) {
      return currentMarks
    }

    const closestBlock = this.getClosestBlock(path)

    // insert mark for empty block; the empty block are often created by split node or add marks in a range including empty blocks
    if (closestBlock.text === '') {
      return currentMarks
    }

    const [previous] = this.previousTexts(path)

    if (!previous) {
      return Set()
    }

    const [previousText, previousPath] = previous

    if (closestBlock.hasDescendant(previousPath)) {
      return previousText.marks
    }

    return currentMarks
  }

  /**
   * Get a set of the marks in a `range`.
   *
   * @param {Range} range
   * @return {Set<Mark>}
   */

  getMarksAtRange(range) {
    const marks = Set(this.getOrderedMarksAtRange(range))
    return marks
  }

  /**
   * Get all of the marks that match a `type`.
   *
   * @param {String} type
   * @return {Set<Mark>}
   */

  getMarksByType(type) {
    const array = this.getMarksByTypeAsArray(type)
    return Set(array)
  }

  /**
   * Get all of the marks that match a `type` as an array.
   *
   * @param {String} type
   * @return {Array}
   */

  getMarksByTypeAsArray(type) {
    const array = this.nodes.reduce((memo, node) => {
      return node.object === 'text'
        ? memo.concat(node.getMarksAsArray().filter(m => m.type === type))
        : memo.concat(node.getMarksByTypeAsArray(type))
    }, [])

    return array
  }

  /**
   * Get the block node after a descendant text node by `path`.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getNextBlock(path) {
    const [entry] = this.nextLeafBlocks(path)
    const block = entry ? entry[0] : null
    return block
  }

  /**
   * Get the next node in the tree, returning siblings or ancestor siblings.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getNextNode(path) {
    const [entry] = this.nextNodes(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get the next sibling of a node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getNextSibling(path) {
    const [entry] = this.nextSiblings(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get the text node after a descendant text node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getNextText(path) {
    const [entry] = this.nextTexts(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get all of the nodes in a `range`. This includes all of the
   * text nodes inside the range and all ancestors of those text
   * nodes up to this node.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getNodesAtRange(range) {
    const iterable = this.createIterable({
      range,
      includeTarget: true,
    })

    const array = Array.from(iterable, ([node]) => node)
    const list = List(array)
    return list

    range = this.resolveRange(range)
    if (range.isUnset) return List()
    const { start, end } = range

    // Do a depth-first stack-based search for all nodes in the range
    // Nodes that are pushed to the stack are inside the range

    // Start with the nodes that are on the highest level in the tree
    let stack = Stack(
      this.nodes
        .slice(start.path.get(0), end.path.get(0) + 1)
        .map((node, index) => ({
          node,
          onStartEdge: index === 0,
          onEndEdge: index === end.path.get(0) - start.path.get(0),
          relativeStartPath: start.path.slice(1),
          relativeEndPath: end.path.slice(1),
        }))
    )

    const result = []

    while (stack.size > 0) {
      const {
        node,
        onStartEdge,
        onEndEdge,
        relativeStartPath,
        relativeEndPath,
      } = stack.peek()

      stack = stack.shift()
      result.push(node)

      if (node.object === 'text') continue

      // Modify indexes to exclude children that are outside of the range
      const startIndex = onStartEdge ? relativeStartPath.get(0) : 0
      const endIndex = onEndEdge ? relativeEndPath.get(0) : node.nodes.size - 1

      // Push children that are inside the range to the stack
      stack = stack.pushAll(
        node.nodes.slice(startIndex, endIndex + 1).map((n, i) => ({
          node: n,
          onStartEdge: onStartEdge && i === 0,
          onEndEdge: onEndEdge && i === endIndex - startIndex,
          relativeStartPath:
            onStartEdge && i === 0 ? relativeStartPath.slice(1) : null,
          relativeEndPath:
            onEndEdge && i === endIndex - startIndex
              ? relativeEndPath.slice(1)
              : null,
        }))
      )
    }

    return List(result)
  }

  /**
   * Get the offset for a descendant text node by `path` or `key`.
   *
   * @param {List|string} path
   * @return {Number}
   */

  getOffset(path) {
    path = this.resolvePath(path)
    this.assertDescendant(path)

    // Calculate the offset of the nodes before the highest child.
    const index = path.first()

    const offset = this.nodes
      .slice(0, index)
      .reduce((memo, n) => memo + n.text.length, 0)

    // Recurse if need be.
    const ret =
      path.size === 1
        ? offset
        : offset + this.nodes.get(index).getOffset(PathUtils.drop(path))
    return ret
  }

  /**
   * Get the offset from a `range`.
   *
   * @param {Range} range
   * @return {Number}
   */

  getOffsetAtRange(range) {
    range = this.resolveRange(range)

    if (range.isUnset) {
      throw new Error('The range cannot be unset to calculcate its offset.')
    }

    if (range.isExpanded) {
      throw new Error('The range must be collapsed to calculcate its offset.')
    }

    const { start } = range
    const offset = this.getOffset(start.path) + start.offset
    return offset
  }

  /**
   * Get all of the marks for all of the characters of every text node.
   *
   * @return {OrderedSet<Mark>}
   */

  getOrderedMarks() {
    const array = this.getMarksAsArray()
    return OrderedSet(array)
  }

  /**
   * Get a set of the marks in a `range`.
   *
   * @param {Range} range
   * @return {OrderedSet<Mark>}
   */

  getOrderedMarksAtRange(range) {
    range = this.resolveRange(range)
    const { start, end } = range

    if (range.isUnset) {
      return OrderedSet()
    }

    if (range.isCollapsed) {
      // PERF: range is not cachable, use path? and offset as proxies for cache
      return this.getMarksAtPosition(start.path, start.offset)
    }

    const marks = this.getOrderedMarksBetweenPositions(
      start.path,
      start.offset,
      end.path,
      end.offset
    )

    return marks
  }

  /**
   * Get a set of the marks in a `range`.
   * PERF: arguments use key and offset for utilizing cache
   *
   * @param {List|string} startPath
   * @param {number} startOffset
   * @param {List|string} endPath
   * @param {number} endOffset
   * @returns {OrderedSet<Mark>}
   */

  getOrderedMarksBetweenPositions(startPath, startOffset, endPath, endOffset) {
    startPath = this.resolvePath(startPath)
    endPath = this.resolvePath(endPath)
    const startText = this.getDescendant(startPath)

    // PERF: if the paths are equal, we can just use the start.
    if (PathUtils.isEqual(startPath, endPath)) {
      return startText.marks
    }

    const texts = this.getTextsBetweenPathPositionsAsArray(startPath, endPath)

    return OrderedSet().withMutations(result => {
      texts.forEach(text => {
        result.union(text.marks)
      })
    })
  }

  /**
   * Get all of the marks that match a `type`.
   *
   * @param {String} type
   * @return {OrderedSet<Mark>}
   */

  getOrderedMarksByType(type) {
    const array = this.getMarksByTypeAsArray(type)
    return OrderedSet(array)
  }

  /**
   * Get the parent of a descendant node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getParent(path) {
    path = this.resolvePath(path)
    if (!path) return null
    if (!path.size) return null
    const parentPath = PathUtils.lift(path)
    const parent = this.getNode(parentPath)
    return parent
  }

  /**
   * Get the block node before a descendant text node by `path`.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getPreviousBlock(path) {
    const [entry] = this.previousLeafBlocks(path)
    const block = entry ? entry[0] : null
    return block
  }

  /**
   * Get the highest block descendants in a `range`.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getRootBlocksAtRange(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return List()

    const { start, end } = range

    return this.nodes.slice(start.path.first(), end.path.first() + 1)
  }

  /**
   * Get the top-most inline nodes for each text node in a `range`.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getRootInlinesAtRange(range) {
    const array = this.getRootInlinesAtRangeAsArray(range)
    // Remove duplicates by converting it to an `OrderedSet` first.
    const list = List(OrderedSet(array))
    return list
  }

  /**
   * Get the top-most inline nodes for each text node in a `range` as an array.
   *
   * @param {Range} range
   * @return {Array}
   */

  getRootInlinesAtRangeAsArray(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return List()

    const array = this.getTextsAtRangeAsArray(range)
      .map(text => this.getFurthestInline(text.key))
      .filter(exists => exists)

    return array
  }

  /**
   * Get the previous node from a node in the tree.
   *
   * This will not only check for siblings but instead move up the tree
   * returning the previous ancestor if no sibling is found.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getPreviousNode(path) {
    const [entry] = this.previousNodes(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get the previous sibling of a node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getPreviousSibling(path) {
    const [entry] = this.previousSiblings(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get the text node before a descendant text node.
   *
   * @param {List|String} path
   * @return {Node|Null}
   */

  getPreviousText(path) {
    const [entry] = this.previousTexts(path)
    const node = entry ? entry[0] : null
    return node
  }

  /**
   * Get the descendent text node at an `offset`.
   *
   * @param {String} offset
   * @return {Node|Null}
   */

  getTextAtOffset(offset) {
    // PERF: Add a few shortcuts for the obvious cases.
    if (offset === 0) return this.getFirstText()
    if (offset === this.text.length) return this.getLastText()
    if (offset < 0 || offset > this.text.length) return null

    let length = 0

    for (const [node] of this.texts()) {
      length += node.text.length

      if (length > offset) {
        return node
      }
    }

    return null
  }

  /**
   * Get the direction of the node's text.
   *
   * @return {String}
   */

  getTextDirection() {
    const dir = getDirection(this.text)
    return dir === 'neutral' ? null : dir
  }

  /**
   * Recursively get all of the child text nodes in order of appearance.
   *
   * @return {List<Node>}
   */

  getTexts() {
    const array = this.getTextsAsArray()
    return List(array)
  }

  /**
   * Recursively get all the leaf text nodes in order of appearance, as array.
   *
   * @return {List<Node>}
   */

  getTextsAsArray() {
    const array = Array.from(this.texts(), ([node]) => node)
    return array
  }

  /**
   * Get all of the text nodes in a `range` as a List.
   *
   * @param {Range} range
   * @return {List<Node>}
   */

  getTextsAtRange(range) {
    const arr = this.getTextsAtRangeAsArray(range)
    return List(arr)
  }

  /**
   * Get all of the text nodes in a `range` as an array.
   *
   * @param {Range} range
   * @return {Array<Node>}
   */

  getTextsAtRangeAsArray(range) {
    range = this.resolveRange(range)
    if (range.isUnset) return []
    const { start, end } = range
    const texts = this.getTextsBetweenPathPositionsAsArray(start.path, end.path)
    return texts
  }

  /**
   * Get all of the text nodes in a `range` as an array.
   * PERF: use key / path in arguments for cache
   *
   * @param {List|string} startPath
   * @param {List|string} endPath
   * @returns {Array}
   */

  getTextsBetweenPositionsAsArray(startPath, endPath) {
    startPath = this.resolvePath(startPath)
    endPath = this.resolvePath(endPath)

    return this.getTextsBetweenPathPositionsAsArray(startPath, endPath)
  }

  /**
   * Get all of the text nodes in a `range` as an array.
   *
   * @param {List|falsey} startPath
   * @param {List|falsey} endPath
   * @returns {Array}
   */

  getTextsBetweenPathPositionsAsArray(startPath, endPath) {
    // PERF: the most common case is when the range is in a single text node,
    // where we can avoid a lot of iterating of the tree.
    if (startPath && endPath && PathUtils.isEqual(startPath, endPath)) {
      return [this.getDescendant(startPath)]
    } else if (!startPath && !endPath) {
      return this.getTextsAsArray()
    }

    const startIndex = startPath ? startPath.get(0, 0) : 0
    const endIndex = endPath
      ? endPath.get(0, this.nodes.size - 1)
      : this.nodes.size - 1

    let array = []

    this.nodes.slice(startIndex, endIndex + 1).forEach((node, i) => {
      if (node.object === 'text') {
        array.push(node)
      } else {
        // For the node at start and end of this list, we want to provide a start and end path
        // For other nodes, we can just get all their text nodes, they are between the paths
        const childStartPath =
          startPath && i === 0 ? PathUtils.drop(startPath) : null
        const childEndPath =
          endPath && i === endIndex - startIndex
            ? PathUtils.drop(endPath)
            : null

        array = array.concat(
          node.getTextsBetweenPathPositionsAsArray(childStartPath, childEndPath)
        )
      }
    })

    return array
  }

  /**
   * Check if the node has block children.
   *
   * @return {Boolean}
   */

  hasBlockChildren() {
    return !!(this.nodes && this.nodes.find(n => n.object === 'block'))
  }

  /**
   * Check if a child node exists.
   *
   * @param {List|String} path
   * @return {Boolean}
   */

  hasChild(path) {
    const child = this.getChild(path)
    return !!child
  }

  /**
   * Check if a node has inline children.
   *
   * @return {Boolean}
   */

  hasInlineChildren() {
    return !!(
      this.nodes &&
      this.nodes.find(n => n.object === 'inline' || n.object === 'text')
    )
  }

  /**
   * Recursively check if a child node exists.
   *
   * @param {List|String} path
   * @return {Boolean}
   */

  hasDescendant(path) {
    const descendant = this.getDescendant(path)
    return !!descendant
  }

  /**
   * Check if a node has a void parent.
   *
   * @param {List|String} path
   * @param {Editor} editor
   * @return {Boolean}
   */

  hasVoidParent(path, editor) {
    invariant(
      !Value.isValue(editor),
      'As of Slate 0.42.0, the `node.hasVoidParent` method takes an `editor` instead of a `value`.'
    )

    const closest = this.getClosestVoid(path, editor)
    return !!closest
  }

  /**
   * Create an iteratable for all of the inlines of a node with `options`.
   *
   * @param {Options}
   * @return {Iterable}
   */

  inlines(options = {}) {
    const { leaf = false, type = null } = options
    const iterable = this.createIterable({
      path: [],
      objects: ['inline'],
      types: type ? [type] : null,
      match: leaf ? node => node.isLeafInline() : null,
    })

    return iterable
  }

  /**
   * Insert a `node`.
   *
   * @param {List|String} path
   * @param {Node} node
   * @return {Node}
   */

  insertNode(path, node) {
    path = this.resolvePath(path)
    const index = path.last()
    const parentPath = PathUtils.lift(path)
    let parent = this.assertNode(parentPath)
    const nodes = parent.nodes.splice(index, 0, node)
    parent = parent.set('nodes', nodes)
    const ret = this.replaceNode(parentPath, parent)
    return ret
  }

  /**
   * Insert `text` at `offset` in node by `path`.
   *
   * @param {List|String} path
   * @param {Number} offset
   * @param {String} text
   * @return {Node}
   */

  insertText(path, offset, text) {
    path = this.resolvePath(path)
    let node = this.assertDescendant(path)
    node = node.insertText(offset, text)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Check whether the node is a leaf block.
   *
   * @return {Boolean}
   */

  isLeafBlock() {
    const { object, nodes } = this
    if (object !== 'block') return false
    if (!nodes.size) return true

    return nodes.first().object !== 'block'
  }

  /**
   * Check whether the node is a leaf inline.
   *
   * @return {Boolean}
   */

  isLeafInline() {
    const { object, nodes } = this
    if (object !== 'inline') return false
    if (!nodes.size) return true

    return nodes.first().object !== 'inline'
  }

  /**
   * Check whether a descendant node is inside a range. This will return true for all
   * text nodes inside the range and all ancestors of those text nodes up to this node.
   *
   * @param {List|string} path
   * @param {Range} range
   * @return {Node}
   */

  isNodeInRange(path, range) {
    this.assertDescendant(path)
    path = this.resolvePath(path)
    range = this.resolveRange(range)
    if (range.isUnset) return false

    const toStart = PathUtils.compare(path, range.start.path)
    const toEnd = PathUtils.compare(path, range.end.path)
    const is = toStart !== -1 && toEnd !== 1
    return is
  }

  /**
   * Map all child nodes, updating them in their parents. This method is
   * optimized to not return a new node if no changes are made.
   *
   * @param {Function} predicate
   * @return {Node}
   */

  mapChildren(predicate) {
    let { nodes } = this

    nodes.forEach((node, i) => {
      const ret = predicate(node, i, this.nodes)
      if (ret !== node) nodes = nodes.set(ret.key, ret)
    })

    const ret = this.set('nodes', nodes)
    return ret
  }

  /**
   * Map all descendant nodes, updating them in their parents. This method is
   * optimized to not return a new node if no changes are made.
   *
   * @param {Function} predicate
   * @return {Node}
   */

  mapDescendants(predicate) {
    let { nodes } = this

    nodes.forEach((node, index) => {
      let ret = node
      if (ret.object !== 'text') ret = ret.mapDescendants(predicate)
      ret = predicate(ret, index, this.nodes)
      if (ret === node) return

      nodes = nodes.set(index, ret)
    })

    const ret = this.set('nodes', nodes)
    return ret
  }

  /**
   * Merge a node backwards its previous sibling.
   *
   * @param {List|Key} path
   * @return {Node}
   */

  mergeNode(path) {
    const b = this.assertNode(path)
    path = this.resolvePath(path)

    if (path.last() === 0) {
      throw new Error(
        `Unable to merge node because it has no previous sibling: ${b}`
      )
    }

    const withPath = PathUtils.decrement(path)
    const a = this.assertNode(withPath)

    if (a.object !== b.object) {
      throw new Error(
        `Unable to merge two different kinds of nodes: ${a} and ${b}`
      )
    }

    const newNode =
      a.object === 'text'
        ? a.mergeText(b)
        : a.set('nodes', a.nodes.concat(b.nodes))

    let ret = this
    ret = ret.removeNode(path)
    ret = ret.removeNode(withPath)
    ret = ret.insertNode(withPath, newNode)
    return ret
  }

  /**
   * Move a node by `path` to `newPath`.
   *
   * A `newIndex` can be provided when move nodes by `key`, to account for not
   * being able to have a key for a location in the tree that doesn't exist yet.
   *
   * @param {List|Key} path
   * @param {List|Key} newPath
   * @param {Number} newIndex
   * @return {Node}
   */

  moveNode(path, newPath, newIndex = 0) {
    const node = this.assertNode(path)
    path = this.resolvePath(path)
    newPath = this.resolvePath(newPath, newIndex)

    const newParentPath = PathUtils.lift(newPath)
    this.assertNode(newParentPath)

    // TODO: this is a bit hacky, re-creating the operation that led to this method being called
    // Alternative 1: pass the operation through from apply -> value.moveNode
    // Alternative 2: add a third property to the operation called "transformedNewPath", pass that through
    const op = Operation.create({
      type: 'move_node',
      path,
      newPath,
    })
    newPath = PathUtils.transform(path, op).first()

    let ret = this
    ret = ret.removeNode(path)
    ret = ret.insertNode(newPath, node)
    return ret
  }

  /**
   * Create an iteratable for the next leaf blocks in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  nextLeafBlocks(path) {
    const iterable = this.createIterable({
      path,
      objects: ['block'],
      match: node => node.isLeafBlock(),
    })

    return iterable
  }

  /**
   * Create an iteratable for the next nodes in the tree at `path`, either finding
   * siblings or ancestors's siblings.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  nextNodes(path) {
    const iterable = this.createIterable({ path, downward: false })
    return iterable
  }

  /**
   * Create an iteratable for the next siblings in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  nextSiblings(path) {
    const iterable = this.createIterable({
      path,
      upward: false,
      downward: false,
    })

    return iterable
  }

  /**
   * Create an iteratable for the next texts in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  nextTexts(path) {
    const iterable = this.createIterable({
      path,
      objects: ['text'],
    })

    return iterable
  }

  /**
   * Create an iteratable for the previous leaf blocks in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  previousLeafBlocks(path) {
    const iterable = this.createIterable({
      path,
      direction: 'backward',
      objects: ['block'],
      match: node => node.isLeafBlock(),
    })

    return iterable
  }

  /**
   * Create an iteratable for the previous nodes in the tree at `path`, either finding
   * siblings or ancestors's siblings.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  previousNodes(path) {
    const iterable = this.createIterable({
      path,
      downward: false,
      direction: 'backward',
    })

    return iterable
  }

  /**
   * Create an iteratable for the previous siblings in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  previousSiblings(path) {
    const iterable = this.createIterable({
      path,
      upward: false,
      downward: false,
      direction: 'backward',
    })

    return iterable
  }

  /**
   * Create an iteratable for the previous texts in the tree at `path`.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  previousTexts(path) {
    const iterable = this.createIterable({
      path,
      direction: 'backward',
      objects: ['text'],
    })

    return iterable
  }

  /**
   * Remove `mark` from text at `path`.
   *
   * @param {List} path
   * @param {Mark} mark
   * @return {Node}
   */

  removeMark(path, mark) {
    path = this.resolvePath(path)
    let node = this.assertDescendant(path)
    node = node.removeMark(mark)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Remove a node.
   *
   * @param {List|String} path
   * @return {Node}
   */

  removeNode(path) {
    this.assertDescendant(path)
    path = this.resolvePath(path)
    const deep = path.flatMap(x => ['nodes', x])
    const ret = this.deleteIn(deep)
    return ret
  }

  /**
   * Remove `text` at `offset` in node.
   *
   * @param {List|Key} path
   * @param {Number} offset
   * @param {String} text
   * @return {Node}
   */

  removeText(path, offset, text) {
    let node = this.assertDescendant(path)
    node = node.removeText(offset, text.length)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Replace a `node` in the tree.
   *
   * @param {List|Key} path
   * @param {Node} node
   * @return {Node}
   */

  replaceNode(path, node) {
    path = this.resolvePath(path)

    if (!path) {
      throw new Error(
        `Unable to replace a node because it could not be found in the first place: ${path}`
      )
    }

    if (!path.size) return node
    this.assertNode(path)
    const deep = path.flatMap(x => ['nodes', x])
    const ret = this.setIn(deep, node)
    return ret
  }

  /**
   * Resolve a `decoration`, relative to the node, ensuring that the keys and
   * offsets in the decoration exist and that they are synced with the paths.
   *
   * @param {Decoration|Object} decoration
   * @return {Decoration}
   */

  resolveDecoration(decoration) {
    decoration = Decoration.create(decoration)
    decoration = decoration.normalize(this)
    return decoration
  }

  /**
   * Resolve a `point`, relative to the node, ensuring that the keys and
   * offsets in the point exist and that they are synced with the paths.
   *
   * @param {Point|Object} point
   * @return {Point}
   */

  resolvePoint(point) {
    point = Point.create(point)
    point = point.normalize(this)
    return point
  }

  /**
   * Resolve a `range`, relative to the node, ensuring that the keys and
   * offsets in the range exist and that they are synced with the paths.
   *
   * @param {Range|Object} range
   * @return {Range}
   */

  resolveRange(range) {
    range = Range.create(range)
    range = range.normalize(this)
    return range
  }

  /**
   * Resolve a `selection`, relative to the node, ensuring that the keys and
   * offsets in the selection exist and that they are synced with the paths.
   *
   * @param {Selection|Object} selection
   * @return {Selection}
   */

  resolveSelection(selection) {
    selection = Selection.create(selection)
    selection = selection.normalize(this)
    return selection
  }

  /**
   * Set `properties` on a node.
   *
   * @param {List|String} path
   * @param {Object} properties
   * @return {Node}
   */

  setNode(path, properties) {
    let node = this.assertNode(path)
    node = node.merge(properties)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Set `properties` on `mark` on text at `offset` and `length` in node.
   *
   * @param {List|String} path
   * @param {Number} offset
   * @param {Number} length
   * @param {Mark} mark
   * @param {Object} properties
   * @return {Node}
   */

  setMark(path, properties, newProperties) {
    path = this.resolvePath(path)
    let node = this.assertDescendant(path)
    node = node.setMark(properties, newProperties)
    const ret = this.replaceNode(path, node)
    return ret
  }

  /**
   * Split a node by `path` at `position` with optional `properties` to apply
   * to the newly split node.
   *
   * @param {List|String} path
   * @param {Number} position
   * @param {Object} properties
   * @return {Node}
   */

  splitNode(path, position, properties) {
    const child = this.assertNode(path)
    path = this.resolvePath(path)
    let a
    let b

    if (child.object === 'text') {
      ;[a, b] = child.splitText(position)
    } else {
      const befores = child.nodes.take(position)
      const afters = child.nodes.skip(position)
      a = child.set('nodes', befores)
      b = child.set('nodes', afters).regenerateKey()
    }

    if (properties && child.object !== 'text') {
      b = b.merge(properties)
    }

    let ret = this
    ret = ret.removeNode(path)
    ret = ret.insertNode(path, b)
    ret = ret.insertNode(path, a)
    return ret
  }

  /**
   * Create an iteratable for all the text node descendants.
   *
   * @param {List|Array} path
   * @return {Iterable}
   */

  texts(options = {}) {
    const { reverse = false } = options
    const iterable = this.createIterable({
      path: [],
      direction: reverse ? 'backward' : 'forward',
      objects: ['text'],
    })

    return iterable
  }

  /**
   * Deprecated.
   */

  getBlocksAtRange(range) {
    warning(
      false,
      'As of slate@0.44 the `node.getBlocksAtRange` method has been renamed to `getLeafBlocksAtRange`.'
    )

    return this.getLeafBlocksAtRange(range)
  }

  getBlocksAtRangeAsArray(range) {
    warning(
      false,
      'As of slate@0.44 the `node.getBlocksAtRangeAsArray` method has been renamed to `getLeafBlocksAtRangeAsArray`.'
    )

    return this.getLeafBlocksAtRangeAsArray(range)
  }

  getInlinesAtRange(range) {
    warning(
      false,
      'As of slate@0.44 the `node.getInlinesAtRange` method has been renamed to `getLeafInlinesAtRange`.'
    )

    return this.getLeafInlinesAtRange(range)
  }

  getInlinesAtRangeAsArray(range) {
    warning(
      false,
      'As of slate@0.44 the `node.getInlinesAtRangeAsArray` method has been renamed to `getLeafInlinesAtRangeAsArray`.'
    )

    return this.getLeafInlinesAtRangeAsArray(range)
  }

  getNextTextAndPath(path) {
    warning(
      false,
      'As of slate@0.47, the `getNextTextAndPath` method has been renamed to `getNextTextEntry`.'
    )

    return this.getNextTextEntry(path)
  }

  getNextDeepMatchingNodeAndPath(path, iterator = () => true) {
    warning(
      false,
      'As of slate@0.47, the `getNextDeepMatchingNodeAndPath` method is deprecated.'
    )

    const match = this.getNextMatchingNodeAndPath(path)

    if (!match) return null

    let [nextNode, nextPath] = match

    let childMatch

    const assign = () => {
      childMatch =
        nextNode.object !== 'text' &&
        nextNode.findFirstDescendantAndPath(iterator, nextPath)
      return childMatch
    }

    while (assign(childMatch)) {
      ;[nextNode, nextPath] = childMatch
    }

    if (!nextNode) return null

    return iterator(nextNode)
      ? [nextNode, nextPath]
      : this.getNextDeepMatchingNodeAndPath(match[1], iterator)
  }

  getPreviousTextAndPath(path) {
    warning(
      false,
      'As of slate@0.47, the `getPreviousTextAndPath` method has been renamed to `getPreviousTextEntry`.'
    )

    return this.getPreviousTextEntry(path)
  }

  findFirstDescendantAndPath(iterator, pathToThisNode) {
    warning(
      false,
      'As of slate@0.47, the `findFirstDescendantAndPath` method is deprecated.'
    )

    return this.findDescendantAndPath(iterator, pathToThisNode, false)
  }

  getPreviousMatchingNodeAndPath(path, iterator = () => true) {
    warning(
      false,
      'As of slate@0.47, the `getPreviousMatchingNodeAndPath` method is deprecated.'
    )

    if (!path) return null

    for (let i = path.size; i > 0; i--) {
      const p = path.slice(0, i)
      if (p.last() === 0) continue

      let previousPath = PathUtils.decrement(p)
      let previousNode = this.getNode(previousPath)

      while (previousNode && !iterator(previousNode)) {
        previousPath = PathUtils.decrement(previousPath)
        previousNode = this.getNode(previousPath)
      }

      if (previousNode) return [previousNode, previousPath]
    }

    return null
  }

  getPreviousDeepMatchingNodeAndPath(path, iterator = () => true) {
    warning(
      false,
      'As of slate@0.47, the `getPreviousDeepMatchingNodeAndPath` method is deprecated.'
    )

    const match = this.getPreviousMatchingNodeAndPath(path)

    if (!match) return null

    let [previousNode, previousPath] = match

    let childMatch

    const assign = () => {
      childMatch =
        previousNode.object !== 'text' &&
        previousNode.findLastDescendantAndPath(iterator, previousPath)
      return childMatch
    }

    while (assign(childMatch)) {
      ;[previousNode, previousPath] = childMatch
    }

    if (!previousNode) return null

    return iterator(previousNode)
      ? [previousNode, previousPath]
      : this.getPreviousDeepMatchingNodeAndPath(match[1], iterator)
  }

  findLastDescendantAndPath(iterator, pathToThisNode) {
    warning(
      false,
      'As of slate@0.47, the `findLastDescendantAndPath` method is deprecated.'
    )

    return this.findDescendantAndPath(iterator, pathToThisNode, true)
  }

  findDescendantAndPath(
    iterator,
    pathToThisNode = PathUtils.create([]),
    findLast = false
  ) {
    warning(
      false,
      'As of slate@0.47, the `findDescendantAndPath` method is deprecated.'
    )

    let found
    let foundPath

    this.forEachDescendantWithPath(
      (node, path, nodes) => {
        if (iterator(node, path, nodes)) {
          found = node
          foundPath = path
          return false
        }
      },
      pathToThisNode,
      findLast
    )

    return found ? [found, foundPath] : null
  }

  forEachDescendantWithPath(iterator, path = PathUtils.create([]), findLast) {
    warning(
      false,
      'As of slate@0.47, the `forEachDescendantWithPath` method is deprecated.'
    )

    let nodes = this.nodes
    let ret

    if (findLast) nodes = nodes.reverse()

    nodes.forEach((child, i) => {
      const childPath = path.concat(i)

      if (iterator(child, childPath, nodes) === false) {
        ret = false
        return false
      }

      if (child.object !== 'text') {
        ret = child.forEachDescendantWithPath(iterator, childPath, findLast)
        return ret
      }
    })

    return ret
  }

  getNextMatchingNodeAndPath(path, iterator = () => true) {
    warning(
      false,
      'As of slate@0.47, the `getNextMatchingNodeAndPath` method is deprecated.'
    )

    if (!path) return null

    for (let i = path.size; i > 0; i--) {
      const p = path.slice(0, i)

      let nextPath = PathUtils.increment(p)
      let nextNode = this.getNode(nextPath)

      while (nextNode && !iterator(nextNode)) {
        nextPath = PathUtils.increment(nextPath)
        nextNode = this.getNode(nextPath)
      }

      if (nextNode) return [nextNode, nextPath]
    }

    return null
  }

  getSelectionIndexes(range, isSelected = true) {
    warning(
      false,
      'As of slate@0.47, the `getSelectionIndexes` method is deprecated.'
    )

    const { start, end } = range

    // PERF: if we're not selected, we can exit early.
    if (!isSelected) {
      return null
    }

    // PERF: if we've been given an invalid selection we can exit early.
    if (range.isUnset) {
      return null
    }

    // PERF: if the start and end keys are the same, just check for the child
    // that contains that single key.
    if (start.path.equals(end.path)) {
      const child = this.getFurthestAncestor(start.path)
      const index = child ? this.nodes.indexOf(child) : null
      return { start: index, end: index + 1 }
    }

    // Otherwise, check all of the children...
    let startIndex = null
    let endIndex = null

    this.nodes.forEach((child, i) => {
      if (child.object === 'text') {
        if (startIndex == null && child.key === start.key) startIndex = i
        if (endIndex == null && child.key === end.key) endIndex = i + 1
      } else {
        if (startIndex == null && child.hasDescendant(start.key)) startIndex = i
        if (endIndex == null && child.hasDescendant(end.key)) endIndex = i + 1
      }

      // PERF: exit early if both start and end have been found.
      return startIndex == null || endIndex == null
    })

    if (isSelected && startIndex == null) {
      startIndex = 0
    }

    if (isSelected && endIndex == null) {
      endIndex = this.nodes.size
    }

    if (startIndex == null) {
      return null
    }

    return { start: startIndex, end: endIndex }
  }
}

/**
 * Mix in assertion variants.
 */

const ASSERTS = ['Child', 'Depth', 'Descendant', 'Node', 'Parent', 'Path']

for (const method of ASSERTS) {
  ElementInterface.prototype[`assert${method}`] = function(path, ...args) {
    const ret = this[`get${method}`](path, ...args)

    if (ret == null) {
      throw new Error(
        `\`Node.assert${method}\` could not find node with path or key: ${path}`
      )
    }

    return ret
  }
}

/**
 * Memoize read methods.
 */

memoize(ElementInterface.prototype, [
  'getBlocksAsArray',
  'getBlocksByTypeAsArray',
  'getDecorations',
  'getFragmentAtRange',
  'getInlinesAsArray',
  'getInlinesByTypeAsArray',
  'getInsertMarksAtRange',
  'getLeafBlocksAtRangeAsArray',
  'getLeafBlocksAtRangeAsArray',
  'getLeafInlinesAtRangeAsArray',
  'getMarksAsArray',
  'getMarksAtPosition',
  'getMarksByTypeAsArray',
  'getNextBlock',
  'getNodesAtRange',
  'getNodesToPathsMap',
  'getOffset',
  'getOffsetAtRange',
  'getOrderedMarksBetweenPositions',
  'getPreviousBlock',
  'getRootBlocksAtRange',
  'getRootInlinesAtRangeAsArray',
  'getTextAtOffset',
  'getTextDirection',
  'getTextsAsArray',
  'getTextsBetweenPathPositionsAsArray',
])

/**
 * Mix in the element interface.
 */

mixin(ElementInterface, [Block, Document, Inline])
