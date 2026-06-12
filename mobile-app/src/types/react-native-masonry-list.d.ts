// Minimal type declaration for react-native-masonry-list v2.16.2 (pure JS
// library, no types shipped). Covers only the surface GalleryScreen uses;
// extend if the lib's API surface grows in callers.
declare module 'react-native-masonry-list' {
  import type { ComponentType } from 'react';

  export interface MasonryImage {
    uri?: string;
    url?: string;
    URI?: string;
    URL?: string;
    source?: { uri: string };
    width?: number;
    height?: number;
    dimensions?: { width: number; height: number };
    // Library adds an index when rendering; consumers can read it from the
    // onPressImage callback's first arg.
    index?: number;
    [extra: string]: unknown;
  }

  export interface MasonryListProps {
    images: MasonryImage[];
    columns?: number;
    spacing?: number;
    backgroundColor?: string;
    imageContainerStyle?: object;
    listContainerStyle?: object;
    initialColToRender?: number;
    initialNumInColsToRender?: number;
    sorted?: boolean;
    onPressImage?: (item: MasonryImage, index: number) => void;
    onLongPressImage?: (item: MasonryImage, index: number) => void;
    onEndReached?: (info?: { distanceFromEnd: number }) => void;
    onEndReachedThreshold?: number;
    // Forwarded to the underlying FlatList for pull-to-refresh (lib passes
    // these straight through — see node_modules/.../src/MasonryList.js).
    refreshing?: boolean;
    onRefresh?: () => void;
    rerender?: boolean;
    customImageComponent?: ComponentType<any>;
    customImageProps?: object;
    masonryFlatListColProps?: object;
    renderIndividualHeader?: any;
    renderIndividualFooter?: any;
    completeCustomComponent?: any;
    onImageResolved?: (image: MasonryImage) => void;
    onImagesResolveEnd?: () => void;
  }

  const MasonryList: ComponentType<MasonryListProps>;
  export default MasonryList;
}
