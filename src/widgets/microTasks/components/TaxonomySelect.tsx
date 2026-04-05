import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
import clsx from 'clsx';

import { TAXONOMY_DROPDOWN_SELECTOR } from '../utils/constants';

const getReferenceElement = (reference: ReferenceType | null): Element | null => {
  if (!reference) return null;
  if (reference instanceof Element) return reference;
  return reference.contextElement ?? null;
};

export type TaxonomySelectOption = {
  value: string;
  label: string;
};

type TaxonomySelectProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder: string;
  options: TaxonomySelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  enableSearch?: boolean;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
  onSelectOption?: (option: TaxonomySelectOption) => void | Promise<void>;
  clearOnSelect?: boolean;
};

export function TaxonomySelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  ariaLabel,
  className,
  enableSearch = false,
  searchPlaceholder = 'Поиск…',
  emptyStateLabel = 'Нет доступных вариантов',
  onSelectOption,
  clearOnSelect = true,
}: TaxonomySelectProps) {
  const [internalValue, setInternalValue] = useState('');
  const currentValue = value ?? internalValue;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [floatingWidth, setFloatingWidth] = useState<number | null>(null);
  const selectId = useId();
  const listId = `${selectId}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
  });

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        refs.floating.current?.contains(target) ||
        (target instanceof HTMLElement &&
          target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, refs.floating]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const referenceEl = getReferenceElement(refs.reference.current);
    const nextWidth = Math.max(
      referenceEl?.getBoundingClientRect().width ?? 0,
      256,
    );
    setFloatingWidth(nextWidth);
    if (enableSearch) setSearchQuery('');
  }, [isOpen, enableSearch, refs.reference]);

  const filteredOptions = useMemo(() => {
    if (!enableSearch) return options;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(query),
    );
  }, [options, searchQuery, enableSearch]);

  const selectedOption = options.find((option) => option.value === currentValue);
  const inputDisplayValue =
    isOpen && enableSearch ? searchQuery : (selectedOption?.label ?? '');
  const inputPlaceholder = isOpen && enableSearch ? searchPlaceholder : placeholder;

  const commitValue = (nextValue: string) => {
    if (onChange) onChange(nextValue);
    else setInternalValue(nextValue);
  };

  const handleSelect = async (option: TaxonomySelectOption) => {
    if (disabled) return;
    commitValue(option.value);
    if (onSelectOption) {
      try {
        await onSelectOption(option);
      } catch (error) {
        console.error(error);
      }
    }
    if (clearOnSelect) commitValue('');
    setIsOpen(false);
    setSearchQuery('');
  };

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!enableSearch) return;
    if (!isOpen) openDropdown();
    setSearchQuery(event.target.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') setIsOpen(false);
    if ((event.key === 'Enter' || event.key === 'ArrowDown') && !isOpen) {
      event.preventDefault();
      openDropdown();
    }
  };

  const assignReference = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    refs.setReference(node);
  };

  return (
    <div
      ref={assignReference}
      data-taxonomy-dropdown="true"
      className={clsx('relative', className)}
    >
      <div
        className={clsx(
          'flex items-center rounded-full border border-white/20 px-3 py-1.5 transition focus-within:ring-2 focus-within:ring-accent/40',
          disabled
            ? 'cursor-not-allowed bg-white/5 text-muted opacity-60'
            : 'bg-white/10 text-text hover:border-white/40',
        )}
        onMouseDown={(event) => {
          if (event.target === inputRef.current) return;
          event.preventDefault();
          if (disabled) return;
          openDropdown();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={ariaLabel ?? placeholder}
          placeholder={inputPlaceholder}
          value={inputDisplayValue}
          onFocus={openDropdown}
          onClick={() => {
            if (!isOpen) openDropdown();
          }}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          readOnly={!enableSearch}
          disabled={disabled}
          autoComplete="off"
          className={clsx(
            'flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted',
            disabled && 'cursor-not-allowed text-muted',
          )}
        />
        <button
          type="button"
          aria-label={isOpen ? 'Свернуть список' : 'Развернуть список'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            if (disabled) return;
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className={clsx(
            'ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] transition',
            disabled
              ? 'text-muted/50'
              : isOpen
                ? 'rotate-180 text-accent'
                : 'text-muted',
          )}
        >
          ▾
        </button>
      </div>
      {isOpen && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-taxonomy-dropdown="true"
            style={{ ...floatingStyles, width: floatingWidth ?? undefined }}
            className="z-[1200] mt-2 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-background/90 p-2 text-sm text-text shadow-2xl backdrop-blur"
          >
            <ul
              role="listbox"
              id={listId}
              aria-labelledby={selectId}
              className="max-h-56 overflow-y-auto pr-1"
            >
              {filteredOptions.map((option) => (
                <li key={option.value} className="py-0.5">
                  <button
                    type="button"
                    role="option"
                    aria-selected={currentValue === option.value}
                    onClick={() => {
                      void handleSelect(option);
                    }}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition',
                      currentValue === option.value
                        ? 'bg-accent/20 text-accent'
                        : 'text-text hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span>{option.label}</span>
                    {currentValue === option.value && (
                      <span aria-hidden="true">✓</span>
                    )}
                  </button>
                </li>
              ))}
              {filteredOptions.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-muted">
                  {emptyStateLabel}
                </li>
              )}
            </ul>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
