/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @oncall ws_labs
 */
import type {Widgets} from 'blessed';

import blessed from 'blessed';
import chalk from 'chalk';
import stringWidth from 'string-width';

export type ListComponentOption = {
  width: number;
  height: number;
  left: number;
  top: number;
  label: string;
};

export type ListItemSelectInfo = {
  keyName: string;
};

export type ListCallbacks = {
  selectCallback?: (
    componentId: number,
    index: number,
    content: string[],
    selectInfo: ListItemSelectInfo,
  ) => void;
  updateContent?: (oldContent: string[], newContent: string[]) => void;
  getFocus?: () => void;
  render?: () => void;
};

/**
 * A ListComponent is an UI list component in CLI.
 * It managers all the UI events related to the
 * list component (e.g., scroll up, down, left, right, and other key strokes)
 */
export default class ListComponent {
  public element: Widgets.ListElement;
  public id: number;
  private listIndex = 0;
  private content: string[] = [];
  private callbacks: ListCallbacks;
  private horizonScrollPositionMap: Map<number, number>;
  private displayedItems: number;
  private moreEntryIndex = -1;
  private static readonly ListContentLimit = 100;
  private static readonly loadMore = 20;

  private static nextComponentId = 0;
  private static nextId(): number {
    return ListComponent.nextComponentId++;
  }

  constructor(
    content: string[],
    callbacks: ListCallbacks,
    options: ListComponentOption,
  ) {
    this.id = ListComponent.nextId();
    this.horizonScrollPositionMap = new Map();
    this.callbacks = callbacks;
    // init list element
    this.element = blessed.list({
      ...options,
      tags: true,
      scrollable: true,
      keys: true,
      border: {
        fg: 'grey',
        type: 'line',
      } as unknown as Widgets.Border,
      style: {
        item: {
          fg: 'white',
          bg: 'default',
        },
        selected: {
          bg: 'grey',
          bold: true,
        },
      },
    });
    this.setContent(content);
    this.registerKeys();
  }

  // render the whole screen
  private render(): void {
    if (this.callbacks.render) {
      this.callbacks.render();
    }
  }

  private static createEntryForMore(more: number): string {
    const key = chalk.inverse('enter');
    return chalk.grey(` ${more} more ... (select and ${key} to load)`);
  }

  protected registerKeys() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.element.on(
      'keypress',
      (char: string, key: Widgets.Events.IKeyEventArg) => {
        const content = self.content;

        // if selecting "More"
        if (
          key.name === 'enter' &&
          content.length > 0 &&
          self.listIndex >= 0 &&
          self.listIndex === self.moreEntryIndex
        ) {
          self.loadMoreContent();
          return;
        }

        // move selection down
        if (key.name === 'down' && self.listIndex < self.displayedItems - 1) {
          self.element.select(++self.listIndex);
          self.selectUpdate(self.listIndex, content, {
            keyName: key.name,
          });

          // move selection up
        } else if (key.name === 'up' && self.listIndex > 0) {
          self.element.select(--self.listIndex);
          self.selectUpdate(self.listIndex, content, {
            keyName: key.name,
          });

          // hit enter to select the current heap object
        } else if (key.name === 'enter') {
          self.selectUpdate(self.listIndex, content, {
            keyName: key.name,
          });

          // scroll left
        } else if (key.name === 'left') {
          self.scrollLeft();

          // scroll right
        } else if (key.name === 'right') {
          self.scrollRight();
        }
      },
    );
  }

  private scrollLeft() {
    const selectedContent = this.content[this.listIndex];
    if (!selectedContent) {
      return;
    }
    let offset = 0;
    if (this.horizonScrollPositionMap.has(this.listIndex)) {
      offset = this.horizonScrollPositionMap.get(this.listIndex) ?? 0;
    }
    if (offset === 0) {
      return;
    }
    this.horizonScrollPositionMap.set(this.listIndex, --offset);
    let newContent = selectedContent.substring(offset) as unknown;
    if (offset > 0) {
      newContent = chalk.grey('...') + newContent;
    }
    this.element.spliceItem(
      this.listIndex,
      1,
      newContent as Widgets.BlessedElement,
    );
    this.element.select(this.listIndex);
  }

  private scrollRight() {
    const selectedContent = this.content[this.listIndex];
    if (!selectedContent || stringWidth(selectedContent) <= 5) {
      return;
    }
    let offset = 0;
    if (this.horizonScrollPositionMap.has(this.listIndex)) {
      offset = this.horizonScrollPositionMap.get(this.listIndex) ?? 0;
    }
    this.horizonScrollPositionMap.set(this.listIndex, ++offset);
    let newContent = selectedContent.substring(offset) as unknown;
    if (offset > 0) {
      newContent = chalk.grey('...') + newContent;
    }
    this.element.spliceItem(
      this.listIndex,
      1,
      newContent as Widgets.BlessedElement,
    );
    this.element.select(this.listIndex);
  }

  public focus(): void {
    this.element.focus();
    this.element.style.border.fg = 'white';
    this.getFocus();
  }

  public loseFocus(): void {
    this.element.style.border.fg = 'grey';
  }

  public selectIndex(index: number): void {
    while (
      this.displayedItems <= index &&
      this.displayedItems < this.content.length
    ) {
      this.loadMoreContent();
    }
    this.listIndex = index;
    this.element.select(index);
  }

  public setContent(content: string[]): void {
    const oldContent = this.content;
    this.element.clearItems();
    this.displayedItems = 0;
    this.moreEntryIndex = -1;
    this.listIndex = 0;
    // push list items into the list
    for (let i = 0; i < content.length; ++i) {
      if (this.displayedItems >= ListComponent.ListContentLimit) {
        break;
      }
      this.element.pushItem(content[i] as unknown as Widgets.BlessedElement);
      ++this.displayedItems;
    }
    this.content = content;
    this.horizonScrollPositionMap.clear();
    this.insertDisplayMoreEntry();
    this.updateContent(oldContent, this.content);
  }

  public loadMoreContent(): void {
    if (this.moreEntryIndex < 0) {
      return;
    }
    const curIndex = this.listIndex;
    this.removeDisplayMoreEntry();
    let idx = this.displayedItems;
    const limit = Math.min(
      this.displayedItems + ListComponent.loadMore,
      this.content.length,
    );
    while (idx < limit) {
      this.element.pushItem(
        this.content[idx++] as unknown as Widgets.BlessedElement,
      );
    }
    this.displayedItems = limit;
    this.insertDisplayMoreEntry();
    this.selectIndex(curIndex);
    this.render();
  }

  private removeDisplayMoreEntry(): void {
    this.element.spliceItem(this.displayedItems - 1, 1);
    this.moreEntryIndex = -1;
    --this.displayedItems;
    --this.listIndex;
  }

  // insert the display more entry
  private insertDisplayMoreEntry(): void {
    if (this.displayedItems < this.content.length) {
      this.element.pushItem(
        ListComponent.createEntryForMore(
          this.content.length - this.displayedItems,
        ) as unknown as Widgets.BlessedElement,
      );
      ++this.displayedItems;
      this.moreEntryIndex = this.displayedItems - 1;
    }
  }

  // function to be overridden
  public updateContent(oldContent: string[], newContent: string[]): void {
    if (this.callbacks.updateContent) {
      this.callbacks.updateContent(oldContent, newContent);
    }
  }

  // function to be overridden
  public getFocus(): void {
    if (this.callbacks.getFocus) {
      this.callbacks.getFocus();
    }
  }

  public selectUpdate(
    index: number,
    content: string[],
    selectInfo: ListItemSelectInfo,
  ): void {
    if (this.callbacks.selectCallback) {
      this.callbacks.selectCallback(this.id, index, content, selectInfo);
    }
  }
}