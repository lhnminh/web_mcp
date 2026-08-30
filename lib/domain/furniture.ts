export type FurnitureKind = 'bed' | 'sofa' | 'desk' | 'dining' | 'coffee' | 'chair' | 'bookcase' | 'nightstand' | 'storage' | 'stove' | 'sink' | 'toilet' | 'shower' | 'fridge' | 'bathtub' | 'washer-dryer' | string;

/**
 * One identity rule for every furniture consumer. The plan, collision UI, and
 * 3D renderer must never infer different objects from the same saved record.
 */
export function getFurnitureKind(category: string, name: string): FurnitureKind {
  const label = name.toLowerCase();
  return label.includes('bed') ? 'bed'
    : label.includes('sofa') ? 'sofa'
      : label.includes('desk') ? 'desk'
        : label.includes('dining') ? 'dining'
          : label.includes('coffee') ? 'coffee'
            : label.includes('chair') ? 'chair'
              : label.includes('bookcase') ? 'bookcase'
                : label.includes('nightstand') ? 'nightstand'
                  : label.includes('dresser') || category === 'storage' ? 'storage'
                    : label.includes('washer') || label.includes('dryer') ? 'washer-dryer'
                      : label.includes('bathtub') || label.includes('bath tub') ? 'bathtub'
                        : label.includes('shower') ? 'shower'
                          : label.includes('toilet') ? 'toilet'
                            : label.includes('fridge') || label.includes('refrigerator') ? 'fridge'
                              : label.includes('sink') ? 'sink'
                                : label.includes('stove') || label.includes('range') ? 'stove'
                    : category;
}
